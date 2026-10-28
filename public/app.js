(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX_FILE = 12*1024*1024, PER_PAGE = 75;
  let allRatings = [], ratings = [], artists = [], page = 0, sort = 'score', sortDir = -1, selectedArtist = '';
  const charts = {};
  const aliases = {
    artist:['artist','artistname','artist_name','performer'],
    album:['album','albumname','album_name','albumtitle','release','title'],
    score:['score','rating','userrating','user_rating','myrating'],
    url:['url','link','albumurl','album_url','releaseurl'],
    type:['type','releasetype','release_type','mediatype','media_type','format','category']
  };
  const normalize = x => String(x).trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const escapeLabel = name => String(name).replace(/\s+/g,' ').trim();
  const field = (obj,key) => {
    const allowed = new Set(aliases[key].map(normalize));
    const name = Object.keys(obj).find(k=>allowed.has(normalize(k)));
    return name === undefined ? undefined : obj[name];
  };
  // AOTY's community API uses mediaType (LP, EP, Single, etc.).
  // Missing type is deliberately UNCLASSIFIED, never silently called an album.
  function releaseKind(row) {
    const value=String(row.releaseType??row.mediaType??row.type??'').toLowerCase().replace(/[_-]+/g,' ').trim();
    if (!value) return 'unknown';
    if (/^(single|singles|digital single|promo single|7 inch single|12 inch single)$/.test(value)||/\bsingle\b/.test(value)) return 'single';
    if (/^(ep|eps|extended play|mini album|mini-album)$/.test(value)||/\bep\b/.test(value)) return 'ep';
    if (/^(lp|album|albums|studio album|full length|full-length|long play|long player)$/.test(value)||/\blp\b/.test(value)) return 'album';
    return 'other';
  }
  const TYPE_LABELS={album:'Album',ep:'EP',single:'Single',other:'Other',unknown:'Unclassified'};
  function normalizeRatings(rows) {return rows.map(row=>({...row,releaseKind:releaseKind(row)}));}
  function csvRows(raw) {
    const rows = []; let row = [], current = '', quoted = false;
    const text=String(raw).replace(/^\uFEFF/,'');
    for (let i=0;i<text.length;i++) {
      const char=text[i];
      if (char==='"') {
        if (quoted && text[i+1]==='"') {current+='"';i++;}
        else if (quoted || current.length===0) quoted=!quoted;
        else current+=char;
      } else if (char===','&&!quoted) {row.push(current);current='';}
      else if ((char==='\n'||char==='\r')&&!quoted) {
        if (char==='\r' && text[i+1]==='\n') i++;
        row.push(current);if(row.some(x=>x.trim()))rows.push(row);
        row=[];current='';
      } else current+=char;
    }
    if(quoted)throw Error('Your CSV has an unfinished quotation mark.');
    row.push(current);if(row.some(x=>x.trim()))rows.push(row);
    return rows;
  }
  function safeUrl(value) {
    if(!value)return null;
    try {
      const u=new URL(String(value).trim());
      return u.protocol==='https:' && ['albumoftheyear.org','www.albumoftheyear.org'].includes(u.hostname) ? u.href : null;
    } catch{return null;}
  }
  function importRatings(content,name) {
    const raw=String(content).trim();if(!raw)throw Error('This file is empty.');
    let source;
    if(/\.json$/i.test(name)||raw[0]==='['||raw[0]==='{') {
      let parsed;try{parsed=JSON.parse(raw);}catch{throw Error('This JSON file is not valid.');}
      source=Array.isArray(parsed)?parsed:parsed&&parsed.ratings;
      if(!Array.isArray(source))throw Error('JSON must be an array of ratings or an object containing a ratings array.');
    } else {
      const lines=csvRows(raw);
      if(lines.length<2)throw Error('CSV must include a header and at least one rating.');
      const headers=lines.shift();
      source=lines.map(line=>Object.fromEntries(headers.map((h,i)=>[h,line[i]===undefined?'':line[i]])));
    }
    if(source.length>100000)throw Error('Please use a file with no more than 100,000 rows.');
    const out=[], seen=new Set();let skipped=0;
    for(const rec of source) {
      if(!rec||typeof rec!=='object'){skipped++;continue;}
      const artist=escapeLabel(field(rec,'artist')??'');
      const album=escapeLabel(field(rec,'album')??'');
      const rawScore=field(rec,'score');
      const score=Number(rawScore);
      if(!artist||!album||rawScore===undefined||rawScore===null||String(rawScore).trim()===''||!Number.isFinite(score)||score<0||score>100){skipped++;continue;}
      const key=artist.toLowerCase()+'\0'+album.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);
      out.push({artist,album,score,url:safeUrl(field(rec,'url')),releaseType:String(field(rec,'type')??'').trim()||null});
    }
    if(!out.length)throw Error('No valid ratings found. Please use artist, album and score columns (0–100).');
    return {records:out,skipped};
  }
  const mean = a => a.reduce((s,n)=>s+n,0)/a.length;
  const median = a => {const x=[...a].sort((a,b)=>a-b), n=x.length;return n%2?x[(n-1)/2]:(x[n/2-1]+x[n/2])/2;};
  const fmt = n => Number.isInteger(n)?String(n):n.toFixed(1);
  function colors() {
    const s=getComputedStyle(document.body);
    return ['--accent','--blue','--muted','--border'].map(key=>s.getPropertyValue(key).trim());
  }
  function calcArtists() {
    const groups=new Map();
    ratings.forEach(r=>{
      const key=r.artist.toLocaleLowerCase();
      if(!groups.has(key)) groups.set(key,{name:r.artist,albums:[]});
      groups.get(key).albums.push(r);
    });
    artists=Array.from(groups.values()).map(g=>({...g,count:g.albums.length,avg:mean(g.albums.map(r=>r.score))}));
  }
  function renderStats() {
    const scores=ratings.map(x=>x.score);
    const items=[['Total albums',ratings.length.toLocaleString()],['Artists',artists.length.toLocaleString()],
      ['Average',fmt(mean(scores))],['Median',fmt(median(scores))],['Highest',fmt(Math.max(...scores))],['Lowest',fmt(Math.min(...scores))]];
    const fragment=document.createDocumentFragment();
    items.forEach(([label,value])=>{
      const div=document.createElement('div');div.className='stat';
      const a=document.createElement('div');a.className='label';a.textContent=label;
      const b=document.createElement('div');b.className='number';b.textContent=value;
      div.append(a,b);fragment.append(div);
    });
    $('stats').replaceChildren(fragment);
  }
  function showStatus(text,error=false) {$('status').textContent=text;$('status').classList.toggle('error',error);}
  function createChart(id,configuration) {
    if(charts[id]){charts[id].destroy();delete charts[id];}
    if(typeof Chart==='undefined') {
      $(id).parentElement.setAttribute('aria-label','Graph unavailable; the chart library could not load.');
      showStatus('Ratings loaded, but charts could not be loaded on this network. Your table and stats still work.',true);
      return;
    }
    charts[id]=new Chart($(id),configuration);
  }
  function chartOptions(horizontal=false, max=null, click=null) {
    const [accent,blue,muted,border]=colors();
    const scales={
      x:{ticks:{color:muted,maxRotation:0,autoSkip:true},grid:{color:border}},
      y:{ticks:{color:muted,autoSkip:true},grid:{color:border}}
    };
    if(horizontal){scales.x.min=0;if(max!==null)scales.x.max=max;}
    else scales.y.beginAtZero=true;
    return {responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',
      onClick:click||undefined,
      plugins:{legend:{display:false},tooltip:{backgroundColor:'#1b2032',titleColor:'#fff',bodyColor:'#eff2fa'}},
      scales};
  }
  function redrawCharts() {
    if(!ratings.length)return;
    const [accent,blue]=colors(), minimum=Number($('minAlbums').value);
    const top=artists.filter(x=>x.count>=minimum).sort((a,b)=>b.avg-a.avg||b.count-a.count).slice(0,25);
    $('noArtists').hidden=top.length>0;
    $('averageChart').parentElement.style.height=Math.max(300,Math.min(850,top.length*27+55))+'px';
    createChart('averageChart',{type:'bar',
      data:{labels:top.map(x=>x.name),datasets:[{data:top.map(x=>+x.avg.toFixed(1)),backgroundColor:accent,borderRadius:5}]},
      options:chartOptions(true,100,(_event,active)=>{if(active.length)openArtist(top[active[0].index].name);})});
    const counts=[...artists].sort((a,b)=>b.count-a.count).slice(0,15);
    createChart('countChart',{type:'bar',
      data:{labels:counts.map(x=>x.name),datasets:[{data:counts.map(x=>x.count),backgroundColor:blue,borderRadius:5}]},
      options:chartOptions(true,Math.max(...counts.map(x=>x.count))+1,(_event,active)=>{if(active.length)openArtist(counts[active[0].index].name);})});
    const buckets=new Array(10).fill(0);
    ratings.forEach(r=>buckets[Math.min(9,Math.floor(r.score/10))]++);
    createChart('distributionChart',{type:'bar',
      data:{labels:['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–100'],datasets:[{data:buckets,backgroundColor:accent,borderRadius:5}]},
      options:chartOptions(false)});
  }
  function openArtist(name,scroll=true) {
    const artist=artists.find(x=>x.name===name);if(!artist)return;
    selectedArtist=name;
    $('artistPanel').hidden=false;
    $('artistTitle').textContent=artist.name+' · '+artist.count+' album'+(artist.count===1?'':'s');
    const entries=[...artist.albums].sort((a,b)=>b.score-a.score);
    $('artistChart').parentElement.style.height=Math.max(280,Math.min(1400,entries.length*32+65))+'px';
    createChart('artistChart',{type:'bar',
      data:{labels:entries.map(x=>x.album),datasets:[{data:entries.map(x=>x.score),backgroundColor:colors()[1],borderRadius:5}]},
      options:chartOptions(true,100)});
    if(scroll)$('artistPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function renderTable() {
    const query=$('search').value.toLocaleLowerCase().trim();
    const filtered=ratings.filter(x=>(x.artist+' '+x.album).toLocaleLowerCase().includes(query));
    filtered.sort((a,b)=>{
      const v=sort==='score'?a.score-b.score:a[sort].localeCompare(b[sort],undefined,{sensitivity:'base'});
      return sortDir*v;
    });
    const lastPage=Math.max(0,Math.ceil(filtered.length/PER_PAGE)-1);
    page=Math.max(0,Math.min(page,lastPage));
    const portion=filtered.slice(page*PER_PAGE,(page+1)*PER_PAGE);
    $('tableCount').textContent='('+filtered.length.toLocaleString()+')';
    const fragment=document.createDocumentFragment();
    for(const r of portion) {
      const tr=document.createElement('tr');
      const a=document.createElement('td'), b=document.createElement('td'), c=document.createElement('td');
      const btn=document.createElement('button');btn.className='artist-btn';btn.type='button';btn.textContent=r.artist;btn.addEventListener('click',()=>openArtist(r.artist));
      a.append(btn);
      if(r.url) {const link=document.createElement('a');link.href=r.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=r.album;b.append(link);}
      else b.textContent=r.album;
      c.className='right';const badge=document.createElement('span');badge.className='score';badge.textContent=fmt(r.score);c.append(badge);
      tr.append(a,b,c);fragment.append(tr);
    }
    $('rows').replaceChildren(fragment);$('emptyRows').hidden=filtered.length!==0;
    $('prevPage').disabled=page===0;$('nextPage').disabled=page===lastPage;
    $('pageLabel').textContent=filtered.length?'Showing '+(page*PER_PAGE+1)+'–'+Math.min((page+1)*PER_PAGE,filtered.length)+' of '+filtered.length.toLocaleString():'No results';
  }
  function displayCollection(name,profileUrl=null) {
    if(!ratings.length)return;
    calcArtists();$('profileName').textContent=name;
    $('profileLink').hidden=!profileUrl;
    if(profileUrl)$('profileLink').href=profileUrl;
    $('dashboard').hidden=false;$('artistPanel').hidden=true;selectedArtist='';
    $('search').value='';page=0;
    renderStats();redrawCharts();renderTable();
  }
  $('loadForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const user=$('username').value.trim();
    if(!/^[a-z0-9_-]{1,40}$/i.test(user))return showStatus('Enter a valid AOTY username (letters, numbers, _ or -).',true);
    $('load').disabled=true;
    showStatus('Checking whether the profile can be accessed...');
    try {
      const res=await fetch('/api/ratings/'+encodeURIComponent(user));
      const data=await res.json();
      if(!res.ok)throw Error(data.error||'Profile could not be loaded.');
      if(!Array.isArray(data.ratings)||!data.ratings.length)throw Error('No ratings found on that profile.');
      ratings=data.ratings;displayCollection('@'+user,data.profileUrl||null);
      showStatus('Loaded '+ratings.length+' ratings.');
    } catch(e) {showStatus(e.message,true);} finally {$('load').disabled=false;}
  });
  $('importHelp').addEventListener('click',()=>{
    const show=$('importInstructions').hidden;
    $('importInstructions').hidden=!show;$('importHelp').setAttribute('aria-expanded',String(show));
  });
  $('importFile').addEventListener('change',async event=>{
    const file=event.target.files&&event.target.files[0];if(!file)return;
    try {
      if(file.size>MAX_FILE)throw Error('Please import a file smaller than 12 MB.');
      const result=importRatings(await file.text(),file.name);
      ratings=result.records;
      displayCollection('Imported collection · '+file.name);
      showStatus('Imported '+ratings.length.toLocaleString()+' album ratings'+(result.skipped?' · '+result.skipped+' invalid rows skipped':'')+'. Your file stayed on your device.');
    } catch(e){showStatus(e.message,true);}
    finally{event.target.value='';}
  });
  $('minAlbums').addEventListener('change',redrawCharts);
  $('search').addEventListener('input',()=>{page=0;renderTable();});
  document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{
    const key=b.dataset.sort;
    if(sort===key)sortDir=-sortDir;else{sort=key;sortDir=key==='score'?-1:1;}
    page=0;renderTable();
  }));
  $('prevPage').addEventListener('click',()=>{if(page){page--;renderTable();}});
  $('nextPage').addEventListener('click',()=>{page++;renderTable();});
  $('closeArtist').addEventListener('click',()=>{$('artistPanel').hidden=true;selectedArtist='';});
  function applyTheme(light) {
    document.body.classList.toggle('light',light);$('theme').textContent=light?'☾':'☀';
    if(ratings.length){redrawCharts();if(selectedArtist)openArtist(selectedArtist,false);}
  }
  try{applyTheme(localStorage.getItem('rating-atlas-theme')==='light');}catch{applyTheme(false);}
  $('theme').addEventListener('click',()=>{
    const light=!document.body.classList.contains('light');
    applyTheme(light);try{localStorage.setItem('rating-atlas-theme',light?'light':'dark');}catch{}
  });
  const param=new URL(location.href).searchParams.get('user');
  if(param&&/^[a-z0-9_-]{1,40}$/i.test(param))$('username').value=param;
})();
