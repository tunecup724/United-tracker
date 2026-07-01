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

app.get('/api/test', async (req, res) => {
  try {
    const r = await axios.get(`${FA_URL}/operators/UAL/flights/scheduled`, {
      headers: { 'x-apikey': FA_KEY },
      params: { max_pages: 1 },
      timeout: 15000
    });
    const flights = r.data?.scheduled || r.data?.flights || [];
    res.json({
      status: r.status,
      keys: Object.keys(r.data || {}),
      total: flights.length,
      num_pages: r.data?.num_pages,
      sample: flights.slice(0, 3).map(f => ({
        ident: f.ident_iata || f.ident,
        dep: f.origin?.code_iata,
        arr: f.destination?.code_iata,
        departure_delay: f.departure_delay,
        status: f.status,
        scheduled_out: f.scheduled_out,
        actual_off: f.actual_off
      }))
    });
  } catch(e) {
    res.json({ error: e.message, status: e.response?.status, details: e.response?.data });
  }
});

app.get('/api/delays', async (req, res) => {
  try {
    const now = new Date();
    const allFlights = [];

    const r = await axios.get(`${FA_URL}/operators/UAL/flights/scheduled`, {
      headers: { 'x-apikey': FA_KEY },
      params: { max_pages: 10 },
      timeout: 30000
    });

    const flights = r.data?.scheduled || r.data?.flights || [];
    allFlights.push(...flights);

    const filtered = allFlights
      .filter(f => {
        const depDelay = f.departure_delay || 0;
        if (depDelay < 1800) return false;
        const statusLower = (f.status || '').toLowerCase();
        if (f.actual_off) return false;
        if (statusLower.includes('taxiing') || statusLower.includes('en route') || statusLower.includes('landed') || statusLower.includes('arrived')) return false;
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

    res.json({ success: true, data: filtered, total: allFlights.length, timestamp: new Date().toISOString() });
  } catch(e) {
    res.json({ success: false, error: e.message, details: e.response?.data });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
