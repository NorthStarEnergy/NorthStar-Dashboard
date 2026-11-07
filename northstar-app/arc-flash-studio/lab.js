const form = document.querySelector('#inputs');
const fields = form.elements;
const result = document.querySelector('#result');
const pin = document.querySelector('#pin');
const baseline = document.querySelector('#baseline');
let current, pinned;
function render() {
  const number = name => fields.namedItem(name).valueAsNumber;
  const voltage = number('voltage');
  const lv = voltage <= 600;
  fields.fault.min = lv ? 0.5 : 0.2;
  fields.fault.max = lv ? 106 : 65;
  fields.gap.min = lv ? 6.35 : 19.05;
  fields.gap.max = lv ? 76.2 : 254;
  const enclosed = !['VOA','HOA'].includes(fields.ec.value);
  const box = form.querySelector('fieldset');
  box.hidden = box.disabled = !enclosed;
  fields.width.setCustomValidity(enclosed && number('width') <= 4 * number('gap') ? 'Width must exceed four times the conductor gap.' : '');
  current = null;
  pin.disabled = true;
  result.replaceChildren();
  const invalid = form.querySelector('input:invalid');
  if (invalid) {
    result.textContent = invalid.closest('label').textContent.trim() + ' — ' + invalid.validationMessage;
  } else {
    try {
      const inches = name => enclosed ? number(name) / 25.4 : 20;
      const c = new ArcFlashCalculator(voltage,number('fault'),fields.ec.value,number('gap'),number('distance')/25.4,
        inches('width'),inches('height'),inches('depth'),number('duration'));
      const metrics = [['Incident energy at '+number('distance')+' mm',c.E_cal,'cal/cm²'],['Arcing current',c.I_arc,'kA'],['Arc-flash boundary',c.AFB,'mm']];
      if (!metrics.every(([,v])=>Number.isFinite(v) && v>0)) throw Error('Outside calculation range.');
      for (const [label,value,unit] of metrics) {
        const item = document.createElement('div');
        item.className = 'metric';
        const name = document.createElement('span'), reading = document.createElement('strong');
        name.textContent = label;
        reading.textContent = value.toFixed(unit==='mm'?1:3)+' '+unit;
        item.append(name,reading);
        result.append(item);
      }
      current = {energy:c.E_cal, description:[voltage+' V',fields.ec.value,number('fault')+' kA bolted',number('gap')+' mm gap',number('distance')+' mm working distance',number('duration')+' ms',enclosed ? ['width','height','depth'].map(number).join(' × ')+' mm enclosure':'open air'].join(' · ')};
      pin.disabled = false;
    } catch (error) { result.textContent = error.message; }
  }
  baseline.textContent = pinned ? 'Pinned: '+pinned.description+' · '+pinned.energy.toFixed(3)+' cal/cm²'+(current?' | Change: '+(current.energy-pinned.energy).toFixed(3)+' cal/cm²':'') : '';
}
pin.addEventListener('click',()=>{pinned = current; render();});
form.addEventListener('input',render);
form.addEventListener('submit',event=>event.preventDefault());
render();
