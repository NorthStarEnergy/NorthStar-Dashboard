const test=require('node:test'),assert=require('node:assert/strict');
const {validForecastDays,validate}=require('../scripts/capture-daily-report.cjs');
process.env.TZ='America/New_York';
test('forecast accepts tomorrow across the 25-hour Eastern day',()=>{
  assert.equal(validForecastDays(['Nov 2','Nov 3','Nov 4','Nov 5','Nov 6'],new Date('2026-11-01T11:30:00Z')),true);
});
test('forecast accepts the 23-hour spring transition',()=>{
  assert.equal(validForecastDays(['Mar 8','Mar 9','Mar 10','Mar 11','Mar 12'],new Date('2026-03-08T10:30:00Z')),true);
});
test('forecast accepts consecutive days across year end',()=>{
  assert.equal(validForecastDays(['Dec 31','Jan 1','Jan 2','Jan 3','Jan 4'],new Date('2026-12-31T11:30:00Z')),true);
});
test('forecast rejects stale, skipped and distant days',()=>{
  const now=new Date('2026-10-17T10:30:00Z');
  for(const days of [['Oct 16','Oct 17','Oct 18','Oct 19','Oct 20'],['Oct 18','Oct 19','Oct 21','Oct 22','Oct 23'],['Oct 19','Oct 20','Oct 21','Oct 22','Oct 23']])assert.equal(validForecastDays(days,now),false);
});
test('forecast rejects incomplete or invalid labels',()=>{
  assert.equal(validForecastDays(['invalid','Oct 19','Oct 20','Oct 21','Oct 22']),false);
  assert.equal(validForecastDays(['Oct 18']),false);
});
test('capture target allowlist rejects unknown hosts and mismatched locations',()=>{
  validate({id:'flow-kapuskasing',url:'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=04LF001'});
  for(const url of ['http://127.0.0.1/','https://www.theweathernetwork.com/en/city/ca/ontario/dokis/current'])assert.throws(()=>validate({id:'kenora',url}));
});
