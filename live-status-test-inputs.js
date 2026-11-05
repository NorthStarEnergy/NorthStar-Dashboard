/* Browser-local dashboard test inputs. These records never call an operational API. */
(() => {
  'use strict';
  const form = document.getElementById('liveStatusTestForm');
  const log = document.getElementById('liveStatusTestLog');
  const state = document.getElementById('liveStatusTestState');
  if (!form || !log || !state) return;

  const records = [];
  const labels = {dispatch:'Dispatch', standby:'OR standby', activation:'OR activation', generation:'Generating station output', alarm:'Alarm', market:'Market pricing'};
  const presets = {
    dispatch:{target:'APIROQ',value:'24',severity:'info'}, standby:{target:'APIROQ 10N',value:'8',severity:'info'},
    activation:{target:'APIROQ 10N',value:'8',severity:'warning'}, generation:{target:'Iroquois Falls GS',value:'36',severity:'info'},
    alarm:{target:'Generator 2',value:'',severity:'critical'}, market:{target:'IESO',value:'72.50',severity:'info'}
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const stamp = value => new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const render = () => {
    state.textContent = records.length ? `${records.length} local test input${records.length === 1 ? '' : 's'} staged · browser session only.` : 'No local test inputs staged.';
    log.innerHTML = records.length ? records.slice().reverse().map(record => `<article class="live-status-test-record ${escape(record.severity)}"><time>${stamp(record.at)}</time><strong>${escape(labels[record.type])}</strong><span>${escape(record.target)}${record.value !== '' ? ` · ${escape(record.value)}` : ''}</span><small>${escape(record.note || 'Test input')}</small></article>`).join('') : '<p class="muted-note">Add a test input to confirm dashboard handling without affecting live feeds.</p>';
  };
  const add = values => {
    const record = {id:window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()), at:new Date().toISOString(), type:values.type, target:values.target || 'Unspecified target', value:values.value ?? '', severity:values.severity || 'info', note:values.note || ''};
    records.push(record);
    window.dispatchEvent(new CustomEvent('northstar:test-input', {detail:{...record, simulated:true, scope:'browser-local'}}));
    render();
  };
  const addCrewSetup = () => {
    const sites = ['Twin Falls','Iroquois Falls','Island Falls','Old Woman Falls','White Otter Rapids','Camp Three Rapids','Kenora','Fort Frances','Sturgeon Falls'];
    const people = ['Alex Morgan','Sam Taylor','Jordan Lee','Casey Brown','Riley Wilson','Avery Martin','Jamie Clark','Quinn Davis','Morgan Hall','Cameron Young','Drew King','Taylor Scott','Reese Green','Parker Adams','Rowan Baker','Emerson Hill','Finley Carter','Hayden Reed','Kai Cooper','Logan Ward','Micah Bell','Noah Brooks','Sage Kelly','Skylar Price'];
    const shuffled = values => values.map(value => ({value,sort:Math.random()})).sort((a,b)=>a.sort-b.sort).map(item=>item.value);
    const pickedSites = shuffled(sites), crewSites = pickedSites.slice(6);
    const crewSizes = crewSites.map(() => 3 + Math.floor(Math.random()*4));
    const crewPeople = shuffled(people);
    let personIndex = 0;
    const now = new Date().toISOString();
    const records = [];
    pickedSites.forEach((site,index) => {
      const count = index < 6 ? 1 : crewSizes[index-6];
      for (let i=0; i<count; i++) records.push({id:`sim-crew-${index}-${i}`,name:crewPeople[personIndex++],site,kind:'Northstar',company:'',status:'on-site',alone:index<6,overdue:false,needsHelp:false,helpState:'none',checkedIn:now,lastHeard:now});
    });
    window.NorthstarOverview?.feeds && (window.NorthstarOverview.feeds.staff = {data:records,checked:Date.now(),error:false});
    window.dispatchEvent(new CustomEvent('northstar:crew-edit-refresh'));
    state.textContent = `Browser-only crew setup active · 6 solo sites · crew sizes ${crewSizes.join(', ')} · no server check-ins changed.`;
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    add(values);
    form.elements.value.value = '';
    form.elements.note.value = '';
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-live-test-crew-setup]')) addCrewSetup();
    const presetButton = event.target.closest('[data-live-test-preset]');
    if (presetButton) {
      const type = presetButton.dataset.liveTestPreset;
      const preset = presets[type];
      form.elements.type.value = type;
      form.elements.target.value = preset.target;
      form.elements.value.value = preset.value;
      form.elements.severity.value = preset.severity;
      form.elements.note.value = 'Preset test input';
      form.requestSubmit();
    }
    if (event.target.closest('[data-live-test-clear]')) { records.length = 0; window.dispatchEvent(new Event('northstar:test-input-clear')); render(); }
  });
  window.NorthstarLiveStatusTestInputs = {records, add, addCrewSetup, clear:() => {records.length = 0;render();}};
  render();
})();
