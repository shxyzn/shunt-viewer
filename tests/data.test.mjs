import test from 'node:test';
import assert from 'node:assert/strict';
import {levelFromName,caseKey,groupEntries,validROI} from '../data.js';
test('Read only one of the five levels at the end of a filename',()=>{
  for(const n of ['0.5','1.0','1.5','2.0','2.5'])assert.equal(levelFromName(`case007_${n}.png`),Number(n));
  assert.equal(levelFromName('case_11.0.png'),null);
  assert.equal(levelFromName('case_1.0_original.png'),null);
  assert.equal(levelFromName('1.0.png'),1);
});
test('Pair originals and patches across AP/LAT prefixes without losing identifiers',()=>{
  assert.equal(caseKey('AP_case007_1.0.png'),caseKey('LAT_case007_1.0.jpg'));
  assert.notEqual(caseKey('case001_1.0.png'),caseKey('case002_1.0.png'));
  const files=['anterior/images/AP_case007_1.0.png','anterior/images_patch/AP_case007_1.0.png','lateral/images/LAT_case007_1.0.png','lateral/images_patch/LAT_case007_1.0.png'];
  const {cases,warnings}=groupEntries(files.map((p,i)=>({path:'shunt_data/'+p,url:'blob:'+i})));
  assert.equal(cases.length,1);assert.equal(cases[0].complete,true);assert.equal(cases[0].level,1);assert.equal(warnings.length,0);assert.equal(cases[0].views.lateral.patch,'blob:3');
});
test('Conflicting labels and missing views never create an inferred level',()=>{
  const {cases,warnings}=groupEntries([{path:'shunt_data/anterior/images/case_1.0.png',url:'a'},{path:'shunt_data/lateral/images/case_2.0.png',url:'b'}]);
  assert.equal(cases.length,1);assert.equal(cases[0].level,null);assert.ok(warnings.length);
  const incomplete=groupEntries([{path:'shunt_data/anterior/images/case_1.0.png',url:'a'}]);assert.equal(incomplete.cases[0].complete,false);
});
test('Duplicate images require correction instead of silently replacing data',()=>{
  const {cases}=groupEntries([{path:'shunt_data/anterior/images/case_1.0.png',url:'a'},{path:'shunt_data/anterior/images/case_1.0.jpg',url:'b'}]);
  assert.ok(cases[0].errors.some(e=>e.includes('중복')));assert.equal(cases[0].views.ap.image,'a');
});
test('ROI must stay inside its image',()=>{
  assert.equal(validROI([.2,.3,.1,.1]),true);assert.equal(validROI([.9,.2,.5,.1]),false);assert.equal(validROI([0,0,0,.1]),false);assert.equal(validROI([NaN,0,.1,.1]),false);
});
test('Pair Strata A/L series while preserving study identity and date',()=>{
  // Artificial identifiers, not patient records.
  const ap='strata_1234567_20200101_12345670000_A_1.0.png';
  const lat='strata_1234567_20200101_12345670001_L_1.0.png';
  assert.equal(caseKey(ap),caseKey(lat));
  assert.notEqual(caseKey(ap),caseKey(lat.replaceAll('1234567','7654321')));
  assert.notEqual(caseKey(ap),caseKey(lat.replace('20200101','20200102')));
  assert.notEqual(caseKey(ap),caseKey(lat.replace('0001_L','0002_L')));
  const entries=[['anterior/images',ap],['anterior/images_patch',ap],['lateral/images',lat],['lateral/images_patch',lat]].map(([dir,file],i)=>({path:`shunt_data/${dir}/${file}`,url:`blob:${i}`}));
  const {cases,warnings}=groupEntries(entries);
  assert.equal(cases.length,1);assert.equal(cases[0].complete,true);
  assert.equal(cases[0].level,1);assert.equal(warnings.length,0);
  assert.equal(cases[0].views.ap.patch,'blob:1');assert.equal(cases[0].views.lateral.patch,'blob:3');
  entries[3].path=entries[3].path.replace('1.0.png','1.5.png');
  assert.equal(groupEntries(entries).cases[0].level,null);
});
