const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const FA_KEY = '7s7aNdZg9AzDzG3QA5oJ0GdpaCpjjTdt';
const FA_URL = 'https://aeroapi.flightaware.com/aeroapi';

function fmtTime(isoStr, timezone) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true,
      timeZone: timezone || 'America/New_York'
    });
  } catch { return '—'; }
}

app.get('/api/delays', async (req, res) => {
  try {
    const now = new Date();
    const allFlights = [];

    // Fetch all pages of United scheduled flights
    let cursor = null;
    let pageCount = 0;
    const maxPages = 20;

    while (pageCount < maxPages) {
      const params = { max_pages: 1 };
      if (cursor) params.cursor = cursor;

      const r = await axios.get(`${FA_URL}/operators/UAL/flights/scheduled`, {
        headers: { 'x-apikey': FA_KEY },
        params,
        timeout: 15000
      });

      const flights = r.data?.scheduled || [];
      allFlights.push(...flights);
      pageCount++;

      // Check if there are more pages
      const nextCursor = r.data?.links?.next;
      if (!nextCursor || flights.length === 0) break;

      // Extract cursor from next link
      const cursorMatch = nextCursor.match(/cursor=([^&]+)/);
      cursor = cursorMatch ? cursorMatch[1] : null;
      if (!cursor) break;

      await new Promise(r => setTimeout(r, 300));
    }

    const filtered = allFlights
      .filter(f => {
        const depDelay = f.departure_delay || 0;
        if (depDelay < 1800) return false;

        const statusLower = (f.status || '').toLowerCase();
        if (f.actual_off) return false;
        if (statusLower.includes('taxiing') || statusLower.includes('en route') ||
            statusLower.includes('landed') || statusLower.includes('arrived')) return false;

        if (!f.scheduled_out) return false;
        const minsUntilSchedDep = (new Date(f.scheduled_out) - now) / 60000;
        if (minsUntilSchedDep < 30) return false;

        if (!f.scheduled_in) return false;
        const durMins = (new Date(f.scheduled_in) - new Date(f.scheduled_out)) / 60000;
        if (durMins > 120 || durMins <= 0) return false;

        return true;
      })
      .map(f => {
        const tz = f.origin?.timezone || 'America/New_York';
        const depDelayMins = Math.round((f.departure_delay || 0) / 60);
        const arrDelayMins = Math.round((f.arrival_delay || 0) / 60);
        const durMins = Math.round((new Date(f.scheduled_in) - new Date(f.scheduled_out)) / 60000);
        let risk;
        if (depDelayMins >= 90 || arrDelayMins >= 60) risk = 'high';
        else if (depDelayMins >= 45 || arrDelayMins >= 25) risk = 'med';
        else risk = 'low';
        return {
          flightNum: f.ident_iata || f.ident || '—',
          depAirport: f.origin?.code_iata || '—',
          dest: f.destination?.code_iata || '—',
          gate: f.gate_origin || '—',
          terminal: f.terminal_origin || '—',
          schedDep: fmtTime(f.scheduled_out, tz),
          estDep: fmtTime(f.estimated_off || f.estimated_out, tz),
          schedArr: fmtTime(f.scheduled_in, f.destination?.timezone),
          estArr: fmtTime(f.estimated_in, f.destination?.timezone),
          duration: durMins,
          depDelay: depDelayMins,
          arrDelay: arrDelayMins,
          status: f.status || '—',
          inboundFlightId: f.inbound_fa_flight_id || null,
          risk
        };
      })
      .sort((a, b) => {
        const r = { high: 0, med: 1, low: 2 };
        return r[a.risk] - r[b.risk] || b.depDelay - a.depDelay;
      });

    res.json({
      success: true,
      data: filtered,
      total: allFlights.length,
      pages_fetched: pageCount,
      timestamp: new Date().toISOString()
    });
  } catch(e) {
    res.json({ success: false, error: e.message, details: e.response?.data });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
