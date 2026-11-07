// OSHA 1926 Subpart V, Appendix E, Table 7. Threshold columns: 4, 5, 8, 12 cal/cm².
const bands = [
  [4,15,0,[[197,246,394,591],[73,92,147,220],[39,49,78,117],[24,31,49,73]]],
  [15.1,25,0,[[197,246,394,591],[75,94,150,225],[41,51,82,122],[26,33,52,78]]],
  [25.1,36,0,[[138,172,275,413],[53,66,106,159],[30,37,59,89],[19,24,38,58]]],
  [36.1,46,0,[[129,161,257,386],[51,64,102,154],[29,36,58,87],[19,24,38,57]]],
  [46.1,72.5,0,[[18,23,36,55],[10,13,20,30],[6,8,13,19],[4,6,9,13]]],
  [72.6,121,1.02,[[10,12,20,30],[6,7,11,17],[4,5,7,11],[3,3,5,8]]],
  [121.1,145,1.16,[[12,15,24,35],[7,9,15,22],[5,6,10,15],[4,5,8,11]]],
  [145.1,169,1.30,[[12,15,24,36],[7,9,15,22],[5,7,10,16],[4,5,8,12]]],
  [169.1,242,1.72,[[13,17,27,40],[8,10,17,25],[6,7,12,17],[4,5,9,13]]]
];
const voltage = document.querySelector('#kv'), current = document.querySelector('#current');
const rows = document.querySelector('#rows'), mad = document.querySelector('#mad');
const gloveBands = [
  [4,15,0,[[46,58,92,138],[18,22,36,54],[10,12,20,30],[6,8,13,19]]],
  [15.1,25,0,[[28,34,55,83],[11,14,23,34],[7,8,13,20],[4,5,9,13]]],
  [25.1,36,0,[[21,26,42,62],[9,11,18,26],[5,6,10,16],[4,4,7,11]]],
  [36.1,46,0,[[16,20,32,48],[7,9,14,21],[4,5,8,13],[3,4,6,9]]]
];
const glove = new URLSearchParams(location.search).get('scenario') === 'glove';
const cycles = document.querySelector('#cycles');
if (glove) {
  voltage.min = 4;
  voltage.max = 46;
  voltage.value = 25;
  document.querySelector('form h2').textContent = 'Rubber insulating glove exposure';
  document.querySelector('#geometry').textContent = 'Reference assumes 380 mm working distance and the sparkover arc length listed for the voltage band in Table 6.';
  document.querySelector('main > p a').textContent = 'OSHA Appendix E, Table 6 and applicability notes';
}
cycles.addEventListener('input', update);
function update() {
  const v = voltage.valueAsNumber;
  const band = (glove ? gloveBands : bands).find(([lo,hi]) => v >= lo && v <= hi);
  rows.replaceChildren();
  mad.textContent = '';
  if (!voltage.checkValidity() || !band || !cycles.checkValidity()) {
    current.disabled = true;
    rows.textContent = 'Enter a voltage in the selected range and a positive clearing time.';
    return;
  }
  current.disabled = false;
  const currents = v <= 46 ? [5,10,15,20] : [20,30,40,50];
  const old = Number(current.value);
  current.replaceChildren(...currents.map(kA=>new Option(String(kA),String(kA))));
  current.value = String(currents.includes(old) ? old : 20);
  mad.textContent = 'Source band: '+band[0]+'–'+band[1]+' kV.'+(band[2] ? ' Table applicability requires an established minimum approach distance of at least '+band[2].toFixed(2)+' m.' : '');
  const times = band[3][currents.indexOf(Number(current.value))];
  [4,5,8,12].forEach((energy,index)=>{
    const line = document.createElement('div');
    line.className = 'metric';
    line.textContent = energy+' cal/cm² threshold · '+times[index]+' cycles maximum · '+(cycles.valueAsNumber <= times[index] ? 'within listed time' : 'exceeds listed time');
    rows.append(line);
  });
}
voltage.addEventListener('input',update);
current.addEventListener('change',update);
document.querySelector('form').addEventListener('submit',event=>event.preventDefault());
update();
