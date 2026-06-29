const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const AIRLABS_KEY = '09cc4e64-99be-4e97-b1a6-6c7c8106475a';

// All US airports - expanded list
const US_AIRPORTS = new Set([
  'ORD','EWR','IAH','DEN','SFO','LAX','IAD','MIA','BOS','SEA',
  'ATL','DFW','PHX','MCO','SLC','SAN','DCA','TPA','AUS','BNA',
  'LAS','MSP','PDX','CLT','RDU','STL','MCI','IND','CMH','PIT',
  'BUF','CLE','CVG','DAY','DTW','GRR','MKE','PHL','RIC','ROC',
  'SYR','ALB','BDL','ABQ','ELP','OKC','TUL','SAT','HOU','DAL',
  'ICT','OMA','DSM','BZN','BIL','GEG','BOI','JAC','COS','ASE',
  'CKB','HDN','MTJ','DRO','GJT','PUB','SGU','PIH','IDA','TWF',
  'CPR','RKS','LWS','SMF','OAK','SJC','BUR','LGB','SNA','ONT',
  'PSP','FAT','RNO','LIH','OGG','KOA','ITO','HNL','ANC','FAI',
  'JNU','SIT','KTN','PSG','WRG','OME','OTZ','BET','ADQ','AKN',
  'LRD','GRK','ABI','SJT','GGG','TYR','MLU','SHV','LFT','BTR',
  'MSY','MOB','HSV','BHM','MGM','DHN','DFW','TUP','JAN','GPT',
  'MEI','GTR','TRI','CHA','BNA','MEM','NQA','AVL','GSP','CAE',
  'AGS','SAV','JAX','TLH','PNS','VPS','MOB','CSG','ABY','VAL',
  'ECP','SFB','RSW','PIE','SRQ','PBI','FLL','MIA','EYW','GNV',
  'DAB','MLB','ISM','APF','IMM','PHF','NorF','ORF','RIC','CHO',
  'ROA','LYH','SBY','HGR','MDT','ABE','AVP','IPT','ERI','FKL',
  'DUJ','JST','HZL','AGC','BFD','OLE','ITH','ELM','BGM','SYR',
  'PLN','MQT','CIU','IMT','ESC','IRK','TBN','SGF','JLN','FOE',
  'MHK','SLN','DDC','GCK','HYS','LBF','GRI','LNK','OFK','SUX',
  'FSD','ABR','ATY','PIR','MOT','DIK','ISN','GFK','DVL','JMS',
  'FAR','HIB','DLH','INL','LSE','RST','STC','BRD','MOB','AUW'
]);

function fmtTime(str) {
  if (!str) return '—';
  try {
    const timePart = str.slice(11, 16);
    const [h, m] = timePart.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2,'0')} ${ampm}`;
  } catch { return '—'; }
}

function isFuture(depTimeStr) {
  // depTimeStr is like "2026-06-29 21:15:00" in local time
  if (!depTimeStr) return false;
  try {
    // Parse as local time by replacing space with T (no Z suffix = local)
    const depTime = new Date(depTimeStr.replace(' ', 'T'));
    const now = new Date();
    // Add UTC offset to compare correctly
    // AirLabs returns local time, but new Date() without Z treats it as local
    const diffMins = (depTime - now) / 60000;
    return diffMins >= 30;
  } catch { return false; }
}

app.get('/api/delays', async (req, res) => {
  try {
    const url = `https://airlabs.co/api/v9/delays?api_key=${AIRLABS_KEY}&type=departures&airline_iata=UA&delay=30`;
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;
    if (data.error) return res.json({ success: false, error: data.error });

    const raw = data.response || [];

    const filtered = raw
      .filter(f => {
        const dur = f.duration;
        const depDelay = f.dep_delayed || 0;
        const isUS = US_AIRPORTS.has(f.dep_iata) && US_AIRPORTS.has(f.arr_iata);
        const notDeparted = !f.dep_actual && !['landed','diverted','cancelled','active'].includes((f.status || '').toLowerCase());
        const estimatedFuture = isFuture(f.dep_estimated || f.dep_time);
        return dur && dur <= 120 && depDelay >= 30 && isUS && notDeparted && estimatedFuture;
      })
      .map(f => {
        const depDelay = f.dep_delayed || 0;
        const arrDelay = f.arr_delayed || 0;
        let risk;
        if (depDelay >= 90 || arrDelay >= 60) risk = 'high';
        else if (depDelay >= 45 || arrDelay >= 25) risk = 'med';
        else risk = 'low';
        return {
          flightNum: f.flight_iata || '—',
          depAirport: f.dep_iata, dest: f.arr_iata,
          gate: f.dep_gate || '—', terminal: f.dep_terminal || '—',
          schedDep: fmtTime(f.dep_time), estDep: fmtTime(f.dep_estimated || f.dep_actual),
          schedArr: fmtTime(f.arr_time), estArr: fmtTime(f.arr_estimated || f.arr_actual),
          duration: f.duration, depDelay, arrDelay,
          status: f.status || '—', risk
        };
      })
      .sort((a, b) => {
        const r = { high: 0, med: 1, low: 2 };
        return r[a.risk] - r[b.risk] || b.depDelay - a.depDelay;
      });

    res.json({ 
      success: true, 
      data: filtered, 
      total: raw.length,
      serverTime: new Date().toISOString(),
      timestamp: new Date().toISOString() 
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
