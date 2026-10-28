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
  // Treat joint artist credits as contributions from each named artist.
  // Preserve well-known ensemble names that include punctuation as part of their identity.
  const INTACT_ACTS=new Set([
    'earth, wind & fire','tyler, the creator','florence and the machine',
    'mumford & sons','simon & garfunkel','hall & oates','daryl hall & john oates',
    'brooks & dunn','tegan and sara','crosby, stills & nash',
    'crosby, stills, nash & young','the head and the heart','of monsters and men',
    'she & him','angus & julia stone','peter, paul and mary','peter, paul & mary',
    'belle and sebastian','catfish and the bottlemen','marina and the diamonds',
    'siouxsie and the banshees','nick cave & the bad seeds'
  ]);
  let canonicalArtists=new Map();
  function creditParts(credit) {
    const original=String(credit??'').trim();
    if (!original || INTACT_ACTS.has(original.toLocaleLowerCase())) return original?[original]:[];
    // Never split '/' inside stage names such as AC/DC; only spaced separators.
    const joined=original.split(/\s+(?:&|\+|×|x|and|with|featuring|feat\.?|ft\.?|vs\.?)\s+|\s+\/\s+/i);
    const parts=[];
    for (const piece of joined) {
      const segment=piece.trim();
      if(!segment)continue;
      if(INTACT_ACTS.has(segment.toLocaleLowerCase())){parts.push(segment);continue;}
      // Distinguish the surname comma in Tyler, the Creator from
      // AOTY's "Artist A, Artist B" contributor list.
      const comma=segment.split(/,\s+/).filter(Boolean);
      if(comma.length>1)parts.push(...comma);else parts.push(segment);
    }
    const seen=new Set();
    return parts.filter(part=>{
      const key=part.toLocaleLowerCase();
      if(seen.has(key))return false;
      seen.add(key);return true;
    });
  }
  function creditedArtists(credit) {
    return creditParts(credit).map(name=>canonicalArtists.get(name.toLocaleLowerCase())||name);
  }
  function rebuildCanonicalArtists() {
    canonicalArtists=new Map();
    // Favor artist casing from a non-collaboration entry when available.
    for(const r of allRatings) {
      const parts=creditParts(r.artist);
      if(parts.length===1)canonicalArtists.set(parts[0].toLocaleLowerCase(),parts[0]);
    }
  }
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
      const credits=creditedArtists(r.artist);
      credits.forEach(name=>{
        const key=name.toLocaleLowerCase();
        if(!groups.has(key))groups.set(key,{name,albums:[]});
        // One collaborative record belongs to each credited artist, once each.
        groups.get(key).albums.push(r);
      });
    });
    artists=Array.from(groups.values()).map(g=>({...g,count:g.albums.length,avg:mean(g.albums.map(r=>r.score))}));
  }
  function renderStats() {
    const scores=ratings.map(x=>x.score);
    const items=[['Selected releases',ratings.length.toLocaleString()],['Selected artists',artists.length.toLocaleString()],
      ['Average',scores.length?fmt(mean(scores)):'—'],['Median',scores.length?fmt(median(scores)):'—'],
      ['Highest',scores.length?fmt(Math.max(...scores)):'—'],['Lowest',scores.length?fmt(Math.min(...scores)):'—']];
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
  // Draw precise numeric values directly on every bar, including on phones.
  const valueLabels={
    id:'ratingAtlasLabels',
    afterDatasetsDraw(chart){
      const dataset=chart.data.datasets[0],meta=chart.getDatasetMeta(0);
      if(!dataset||!meta||!meta.data)return;
      const horizontal=chart.options.indexAxis==='y';
      const ctx=chart.ctx,muted=colors()[2];
      ctx.save();ctx.fillStyle=muted;ctx.font='600 11px system-ui, sans-serif';
      ctx.textBaseline='middle';
      meta.data.forEach((bar,i)=>{
        const val=dataset.data[i];
        if(!Number.isFinite(Number(val)))return;
        const label=String(val);
        const width=ctx.measureText(label).width;
        if(horizontal){
          ctx.textAlign='left';
          ctx.fillText(label,Math.min(bar.x+7,chart.chartArea.right-width-1),bar.y);
        }else{
          ctx.textAlign='center';
          ctx.fillText(label,bar.x,Math.max(bar.y-9,chart.chartArea.top+11));
        }
      });
      ctx.restore();
    }
  };
  function chartOptions(horizontal=false,max=null,click=null,measure='scores') {
    const [accent,blue,muted,border]=colors();
    const mobile=window.innerWidth<=600, labelLimit=mobile?16:31;
    const axes={
      x:{ticks:{color:muted,maxRotation:0,autoSkip:!horizontal,font:{size:mobile?10:12}},grid:{color:border},border:{display:false}},
      y:{ticks:{color:muted,autoSkip:!horizontal,font:{size:mobile?11:12},padding:7},grid:{color:border},border:{display:false}}
    };
    if(horizontal){
      axes.x.min=0;if(max!==null)axes.x.max=max;
      axes.x.ticks.stepSize=measure==='scores'?20:undefined;
      axes.y.ticks.callback=function(value) {
        const label=String(this.getLabelForValue(value));
        return label.length>labelLimit?label.slice(0,labelLimit-1)+'…':label;
      };
      axes.y.afterFit=axis=>{axis.width=Math.min(mobile?139:235,Math.max(axis.width,85));};
    }else{
      axes.y.beginAtZero=true;
      axes.y.ticks.precision=0;
      axes.x.ticks.maxRotation=mobile?50:0;
      axes.x.ticks.minRotation=mobile?30:0;
    }
    return {
      responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',
      animation:{duration:260},
      layout:{padding:{right:horizontal?41:10,top:17}},
      onClick:click||undefined,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#171c2a',titleColor:'#fff',bodyColor:'#f1f3fa',padding:12,displayColors:false,
          callbacks:{label:context=>measure==='scores'?'Score: '+fmt(Number(context.raw))+' / 100':'Rated releases: '+fmt(Number(context.raw))}
        }
      },
      scales:axes
    };
  }
  function redrawCharts() {
    if(!ratings.length){
      Object.keys(charts).forEach(id=>{charts[id].destroy();delete charts[id];});
      $('noArtists').hidden=false;
      return;
    }
    const [accent,blue]=colors(), minimum=Number($('minAlbums').value);
    const topLimit=Number($('topArtists').value)||10;
    const top=artists.filter(x=>x.count>=minimum).sort((a,b)=>b.avg-a.avg||b.count-a.count).slice(0,topLimit);
    $('noArtists').hidden=top.length>0;
    $('averageChart').parentElement.style.height=Math.max(260,top.length*40+75)+'px';
    createChart('averageChart',{type:'bar',
      data:{labels:top.map(x=>x.name),datasets:[{data:top.map(x=>+x.avg.toFixed(1)),backgroundColor:accent,borderRadius:5,maxBarThickness:25}]},
      options:chartOptions(true,100,(_event,active)=>{if(active.length)openArtist(top[active[0].index].name);},'scores'),
      plugins:[valueLabels]});
    const counts=[...artists].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,12);
    $('countChart').parentElement.style.height=Math.max(265,counts.length*38+55)+'px';
    createChart('countChart',{type:'bar',
      data:{labels:counts.map(x=>x.name),datasets:[{data:counts.map(x=>x.count),backgroundColor:blue,borderRadius:5,maxBarThickness:24}]},
      options:chartOptions(true,Math.max(1,...counts.map(x=>x.count))+Math.max(2,Math.ceil(Math.max(1,...counts.map(x=>x.count))*.15)),
        (_event,active)=>{if(active.length)openArtist(counts[active[0].index].name);},'counts'),
      plugins:[valueLabels]});
    const buckets=new Array(10).fill(0);
    ratings.forEach(r=>buckets[Math.min(9,Math.floor(r.score/10))]++);
    createChart('distributionChart',{type:'bar',
      data:{labels:['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–100'],
        datasets:[{data:buckets,backgroundColor:accent,borderRadius:4,maxBarThickness:45}]},
      options:chartOptions(false,null,null,'counts'),
      plugins:[valueLabels]});
  }
  function openArtist(name,scroll=true) {
    const artist=artists.find(x=>x.name===name);if(!artist)return;
    selectedArtist=name;
    $('artistPanel').hidden=false;
    $('artistTitle').textContent=artist.name+' · '+artist.count+' rated release'+(artist.count===1?'':'s');
    const entries=[...artist.albums].sort((a,b)=>b.score-a.score);
    $('artistChart').parentElement.style.height=Math.max(280,entries.length*42+75)+'px';
    createChart('artistChart',{type:'bar',
      data:{labels:entries.map(x=>x.album+(creditedArtists(x.artist).length>1?' · collaboration':'')),datasets:[{data:entries.map(x=>x.score),backgroundColor:colors()[1],borderRadius:5,maxBarThickness:25}]},
      options:chartOptions(true,100,null,'scores'),plugins:[valueLabels]});
    if(scroll)$('artistPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function renderTable() {
    const query=$('search').value.toLocaleLowerCase().trim();
    const filtered=ratings.filter(x=>(x.artist+' '+x.album).toLocaleLowerCase().includes(query));
    filtered.sort((a,b)=>{
      const v=sort==='score'?a.score-b.score:sort==='releaseType'?a.releaseKind.localeCompare(b.releaseKind):a[sort].localeCompare(b[sort],undefined,{sensitivity:'base'});
      return sortDir*v;
    });
    const lastPage=Math.max(0,Math.ceil(filtered.length/PER_PAGE)-1);
    page=Math.max(0,Math.min(page,lastPage));
    const portion=filtered.slice(page*PER_PAGE,(page+1)*PER_PAGE);
    $('tableCount').textContent='('+filtered.length.toLocaleString()+')';
    const fragment=document.createDocumentFragment();
    for(const r of portion) {
      const tr=document.createElement('tr');
      const a=document.createElement('td'), b=document.createElement('td'), c=document.createElement('td'), d=document.createElement('td');
      const credits=creditedArtists(r.artist);
      if(credits.length>1) {
        const original=document.createElement('div');original.className='credit-original';original.textContent=r.artist;a.append(original);
        const members=document.createElement('div');members.className='credit-members';
        for(const name of credits){
          const btn=document.createElement('button');btn.className='artist-btn credit-member';btn.type='button';btn.textContent=name;
          btn.addEventListener('click',()=>openArtist(name));members.append(btn);
        }
        a.append(members);
      } else {
        const name=credits[0]||r.artist;
        const btn=document.createElement('button');btn.className='artist-btn';btn.type='button';btn.textContent=name;
        btn.addEventListener('click',()=>openArtist(name));a.append(btn);
      }
      if(r.url) {const link=document.createElement('a');link.href=r.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=r.album;b.append(link);}
      else b.textContent=r.album;
      const type=document.createElement('span');type.className='release-badge type-'+r.releaseKind;type.textContent=TYPE_LABELS[r.releaseKind];c.append(type);
      d.className='right';const badge=document.createElement('span');badge.className='score';badge.textContent=fmt(r.score);d.append(badge);
      tr.append(a,b,c,d);fragment.append(tr);
    }
    $('rows').replaceChildren(fragment);$('emptyRows').hidden=filtered.length!==0;
    $('prevPage').disabled=page===0;$('nextPage').disabled=page===lastPage;
    $('pageLabel').textContent=filtered.length?'Showing '+(page*PER_PAGE+1)+'–'+Math.min((page+1)*PER_PAGE,filtered.length)+' of '+filtered.length.toLocaleString():'No results';
  }
  function applyReleaseFilter() {
    const kind=$('releaseFilter').value;
    ratings=kind==='all'?[...allRatings]:allRatings.filter(x=>x.releaseKind===kind);
    const kinds=['album','ep','single','other','unknown'];
    const counts=Object.fromEntries(kinds.map(k=>[k,allRatings.filter(x=>x.releaseKind===k).length]));
    const chips=document.createDocumentFragment();
    for (const k of kinds) {
      const button=document.createElement('button');
      button.type='button';
      button.className='type-chip'+(kind===k?' active':'');
      button.setAttribute('aria-pressed',String(kind===k));
      button.textContent=TYPE_LABELS[k]+' · '+counts[k].toLocaleString();
      button.addEventListener('click',()=>{$('releaseFilter').value=k;applyReleaseFilter();});
      chips.append(button);
    }
    $('releaseCounts').replaceChildren(chips);
    const unknown=counts.unknown;
    $('releaseNote').textContent=kind==='all'
      ? 'All release types combined. Switch to Albums to exclude singles and EPs.'
      : kind==='album'
        ? 'LP albums only. '+counts.single+' singles and '+counts.ep+' EPs are excluded from all graphs and averages.'
        : 'Showing only '+TYPE_LABELS[kind].toLowerCase()+' releases in every chart and the table.';
    if (unknown) $('releaseNote').textContent+=' '+unknown+' release(s) lack type information; add a type column to your import to classify them.';
    $('artistPanel').hidden=true;selectedArtist='';page=0;
    calcArtists();
    const collaborations=ratings.filter(r=>creditedArtists(r.artist).length>1).length;
    $('collabNote').textContent=collaborations
      ? collaborations+' collaborative release'+(collaborations===1?' is':'s are')+' credited to each participating artist. Each release is counted only once in the overall total and score distribution.'
      : 'Collaborations are credited to every named artist when present. Overall release totals count each release only once.';
    renderStats();redrawCharts();renderTable();
  }
  function displayCollection(name,profileUrl=null) {
    if(!allRatings.length)return;
    allRatings=normalizeRatings(allRatings);
    rebuildCanonicalArtists();
    $('profileName').textContent=name;
    $('profileLink').hidden=!profileUrl;
    if(profileUrl)$('profileLink').href=profileUrl;
    $('dashboard').hidden=false;
    $('search').value='';page=0;
    // Only default to Albums when the data actually identifies albums.
    $('releaseFilter').value=allRatings.some(x=>x.releaseKind==='album')?'album':'all';
    applyReleaseFilter();
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
      allRatings=data.ratings;displayCollection('@'+user,data.profileUrl||null);
      showStatus('Loaded '+allRatings.length+' rated releases. Albums, EPs and singles now have separate filters.');
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
      allRatings=result.records;
      displayCollection('Imported collection · '+file.name);
      showStatus('Imported '+allRatings.length.toLocaleString()+' rated releases'+(result.skipped?' · '+result.skipped+' invalid rows skipped':'')+'. Your file stayed on your device.');
    } catch(e){showStatus(e.message,true);}
    finally{event.target.value='';}
  });
  $('releaseFilter').addEventListener('change',applyReleaseFilter);
  $('topArtists').addEventListener('change',redrawCharts);
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
    if(allRatings.length){redrawCharts();if(selectedArtist)openArtist(selectedArtist,false);}
  }
  try{applyTheme(localStorage.getItem('rating-atlas-theme')==='light');}catch{applyTheme(false);}
  $('theme').addEventListener('click',()=>{
    const light=!document.body.classList.contains('light');
    applyTheme(light);try{localStorage.setItem('rating-atlas-theme',light?'light':'dark');}catch{}
  });
  const param=new URL(location.href).searchParams.get('user');
  if(param&&/^[a-z0-9_-]{1,40}$/i.test(param))$('username').value=param;
})();
