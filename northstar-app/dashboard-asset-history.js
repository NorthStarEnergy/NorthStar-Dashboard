/* Read-only graph for a live numeric dashboard asset. */
(() => {
  const samples=new Map(), maxSamples=720;
  const numeric=text=>{
    const value=String(text??'').trim().replace(/,/g,'');
    if(!/^[+$-]?\$?\s*-?\d+(?:\.\d+)?\s*(?:MW|MWh|%|°|°C|kV)?$/i.test(value))return null;
    const n=Number(value.replace(/[^\d.-]/g,''));return Number.isFinite(n)?n:null;
  };
  const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const timeOf=row=>Date.parse(row?.time||row?.timestamp||row?.at||row?.intervalStart||row?.recordedAt||'');
  const add=(key,value,time=Date.now())=>{
    if(!Number.isFinite(value)||!Number.isFinite(time))return;
    const list=samples.get(key)||[];
    if(list.at(-1)?.value===value && time-list.at(-1).time<300000)return;
    list.push({time,value});if(list.length>maxSamples)list.splice(0,list.length-maxSamples);
    samples.set(key,list);
  };
  const market=(node,field,label)=>({
    key:`market:${node}:${field}`,label:`${node} · ${label}`,unit:field==='demand'?'MW':'$/MWh',
    points:()=>{
      const data=window.NorthstarMarketModules?.data()||window.NorthstarOverview?.feeds?.market?.data||{};
      const marketNode=data.nodes?.[node];
      const source=field==='demand'?data.ontario?.demand:field==='forecast'?data.ontario?.forecastSeries:field==='da'?(marketNode?.daHistory||marketNode?.da_history):marketNode?.history;
      return Array.isArray(source)?source.filter(row=>row.value!==null&&row.value!==undefined&&row.value!=='').map(row=>({time:timeOf(row),value:Number(row.value)})):[];
    },
    current:()=>{
      const data=window.NorthstarMarketModules?.data()||window.NorthstarOverview?.feeds?.market?.data||{};
      const value=field==='demand'?data.ontario?.demand:data.nodes?.[node]?.[field];
      return value===null||value===undefined||value===''?NaN:Number(value);
    },source:'Feed history where available; current readings otherwise.'
  });
  const dispatch=(field,label)=>({
    key:`dispatch:${field}`,label,unit:'MW',
    points:()=>{const rows=window.NorthstarOverview?.feeds?.dispatch?.data?.history;return Array.isArray(rows)?rows.map(row=>({time:timeOf(row),value:field==='deltaMw'?Number(row.outputMw)-Number(row.dispatchMw):Number(row[field])})):[];},
    current:()=>{const value=window.NorthstarOverview?.feeds?.dispatch?.data?.[field];return value===null||value===undefined||value===''?NaN:Number(value);},
    source:'Dispatch feed history where available; current readings otherwise.'
  });
  const ownText=node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim();
  const path=node=>{
    const root=node.closest('[data-asset-id],[data-module-id],[data-ns-module],.ns-status-module,.section[id],.overview[id]');
    if(!root)return null;
    const parts=[];let current=node;
    while(current&&current!==root){const parent=current.parentElement;if(!parent)return null;parts.unshift([...parent.children].indexOf(current));current=parent;}
    const scope=root.dataset.assetId||root.dataset.moduleId||root.dataset.nsModule||root.dataset.status||root.id;
    if(!scope)return null;
    return `${scope}/${parts.join('.')}`;
  };
  const resolve=target=>{
    if(!(target instanceof Element)||target.closest('#nsAssetHistory,[hidden],input,textarea,select,[contenteditable]'))return null;
    const fixed=target.closest('#nsStatusBar');
    if(fixed){
      const node=target.closest('[data-node]');
      if(node){const id=node.dataset.node,price=target.closest('.ns-status-price');
        if(price?.classList.contains('ns-status-price-rt'))return market(id,'rt','Real-time price');
        if(price?.classList.contains('ns-status-price-da'))return market(id,'da','Day-ahead price');
        if(price?.classList.contains('ns-status-price-demand'))return market('IESO','demand','Ontario demand');
      }
      if(target.closest('[data-asset-id="dispatch-value"]'))return dispatch('dispatchMw','APIROQ · Dispatch target');
      if(target.closest('[data-asset-id="output-value"]'))return dispatch('outputMw','APIROQ · Output');
    }
    const metric=target.closest('.ov-metric,.dispatch-field');
    if(metric){const label=metric.querySelector('span')?.textContent?.trim()||'';
      const marketModule=metric.closest('[data-ns-module^="markets:"],[data-module-id^="markets:"]');
      if(marketModule){const id=marketModule.dataset.nsModule?.slice(8)||marketModule.dataset.moduleId?.slice(8)||'IESO',node=id==='live'?(window.NorthstarMarketModules?.selectedNode?.()||'IESO'):id;
        if(/real-time/i.test(label))return market(node,'rt','Real-time price');
        if(/day-ahead/i.test(label))return market(node,'da','Day-ahead price');
      }
      if(/output/i.test(label))return dispatch('outputMw','APIROQ · Output');
      if(/dispatch target|^dispatch$/i.test(label))return dispatch('dispatchMw','APIROQ · Dispatch target');
      if(/difference/i.test(label))return dispatch('deltaMw','APIROQ · Difference');
    }
    let valueNode=target;
    if(numeric(ownText(valueNode))===null)valueNode=target.querySelector(':scope > strong,:scope > b,:scope > .ov-weather-value')||target;
    const value=numeric(ownText(valueNode));if(value===null)return null;
    const key=path(valueNode);if(!key)return null;
    const labelNode=valueNode.closest('.ov-metric,.ns-or-item,.ns-status-price,.weather-card,.panel')||valueNode.parentElement;
    const label=(labelNode?.querySelector('small,span,label,h3,h2')?.textContent||labelNode?.getAttribute('aria-label')||valueNode.getAttribute('aria-label')||'Live value').trim().slice(0,100);
    const suffix=ownText(valueNode).match(/(MW|MWh|%|°|°C|kV)$/i)?.[1]||'';
    return {key,label,unit:suffix,points:()=>[],current:()=>samples.get(key)?.at(-1)?.value??value,source:'Recorded in this dashboard tab from live updates.'};
  };
  const feedSamples=()=>{
    for(const [name,field,label] of [['output','outputMw','Output'],['target','dispatchMw','Dispatch target']]){
      const d=dispatch(field,label);add(d.key,d.current());
    }
    const data=window.NorthstarMarketModules?.data()||window.NorthstarOverview?.feeds?.market?.data||{};
    Object.keys(data.nodes||{}).forEach(node=>['rt','da'].forEach(field=>{const d=market(node,field,field);add(d.key,d.current());}));
    const d=market('IESO','demand','Ontario demand');add(d.key,d.current());
    [...document.querySelectorAll('#nsStatusBar strong,#overview .ov-metric strong,.section.active [data-module-id] strong,.section.active .ov-weather-value')].slice(0,500).forEach(node=>{
      const descriptor=resolve(node),value=numeric(ownText(node));
      if(descriptor&&value!==null)add(descriptor.key,value);
    });
  };
  let active=null,range='24',from='',to='',watcher=null,watchScheduled=false;
  const panel=()=>document.getElementById('nsAssetHistory');
  const close=()=>{watcher?.disconnect();watcher=null;panel()?.remove();active=null;};
  const allPoints=descriptor=>{
    const byTime=new Map();
    [...descriptor.points(),...(samples.get(descriptor.key)||[])].forEach(p=>{if(Number.isFinite(p.time)&&Number.isFinite(p.value))byTime.set(p.time,p.value);});
    const ordered=[...byTime].sort((a,b)=>a[0]-b[0]);
    return ordered.filter(([time,value],index)=>index===0||value!==ordered[index-1][1]||time-ordered[index-1][0]>60000).map(([time,value])=>({time,value}));
  };
  const paint=()=>{
    const root=panel();if(!root||!active)return;
    root.querySelector('h2').textContent=active.label;
    const latest=active.current(),points=allPoints(active),now=Date.now();
    const start=range==='custom'?(from?new Date(from).valueOf():-Infinity):range==='all'?-Infinity:now-Number(range)*3600000;
    const end=range==='custom'?(to?new Date(to).valueOf():Infinity):Infinity;
    const shown=points.filter(p=>p.time>=start&&p.time<=end);
    root.querySelector('[data-current]').textContent=Number.isFinite(latest)?`${latest.toLocaleString(undefined,{maximumFractionDigits:2})} ${active.unit}`.trim():'Unavailable';
    root.querySelector('[data-count]').textContent=`${shown.length} reading${shown.length===1?'':'s'}`;
    root.querySelector('[data-source]').textContent=active.source;
    root.querySelectorAll('[data-range]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.range===range)));
    root.querySelector('.ns-history-custom').hidden=range!=='custom';
    const svg=root.querySelector('svg');
    if(shown.length<2){svg.innerHTML='<text x="50%" y="50%" text-anchor="middle">More readings are needed to draw a trend.</text>';return;}
    const values=shown.map(p=>p.value),low=Math.min(...values),high=Math.max(...values),span=high-low||1;
    const first=shown[0].time,last=shown.at(-1).time,dt=last-first||1;
    const y=value=>175-(value-low)/span*145,x=time=>55+(time-first)/dt*595;
    const line=shown.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    svg.innerHTML=`<line x1="55" y1="30" x2="55" y2="175"/><line x1="55" y1="175" x2="650" y2="175"/><path d="${line}"/><text x="50" y="24" text-anchor="end">${esc(high.toFixed(2))}</text><text x="50" y="178" text-anchor="end">${esc(low.toFixed(2))}</text><text x="55" y="199">${esc(new Date(first).toLocaleString())}</text><text x="650" y="199" text-anchor="end">${esc(new Date(last).toLocaleString())}</text>`;
  };
  const open=descriptor=>{
    active=descriptor;add(descriptor.key,descriptor.current());
    let root=panel();
    if(!root){root=document.createElement('section');root.id='nsAssetHistory';root.setAttribute('role','dialog');root.setAttribute('aria-label','Value history graph');
      root.innerHTML='<header><div><small>VALUE HISTORY</small><h2></h2></div><button type="button" data-close aria-label="Close graph">×</button></header><div class="ns-history-summary"><strong data-current></strong><span data-count></span></div><div class="ns-history-ranges" role="group" aria-label="Graph time range"><button type="button" data-range="1">1h</button><button type="button" data-range="6">6h</button><button type="button" data-range="24">24h</button><button type="button" data-range="168">7d</button><button type="button" data-range="all">All</button><button type="button" data-range="custom">Custom</button></div><div class="ns-history-custom" hidden><label>From<input type="datetime-local" data-from></label><label>To<input type="datetime-local" data-to></label></div><svg viewBox="0 0 680 215" role="img" aria-label="Value over time"></svg><p data-source></p>';
      document.body.append(root);
      root.querySelector('[data-close]').onclick=close;
      root.querySelectorAll('[data-range]').forEach(button=>button.onclick=()=>{range=button.dataset.range;paint();});
      root.querySelector('[data-from]').onchange=e=>{from=e.target.value;paint();};
      root.querySelector('[data-to]').onchange=e=>{to=e.target.value;paint();};
    }
    paint();root.querySelector('[data-close]').focus({preventScroll:true});
    watcher?.disconnect();
    watcher=new MutationObserver(changes=>{
      if(!active||watchScheduled||!changes.some(change=>!(change.target.nodeType===Node.ELEMENT_NODE?change.target:change.target.parentElement)?.closest('#nsAssetHistory')))return;
      watchScheduled=true;requestAnimationFrame(()=>{watchScheduled=false;feedSamples();paint();});
    });
    watcher.observe(document.body,{subtree:true,childList:true,characterData:true});
  };
  window.NorthstarAssetHistory={resolve,open};
  const refresh=()=>requestAnimationFrame(()=>{feedSamples();paint();});
  window.addEventListener('northstar:feed-update',refresh);
  window.addEventListener('northstar:market-extra-update',refresh);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel())close();});
  setTimeout(feedSamples,1000);
})();
