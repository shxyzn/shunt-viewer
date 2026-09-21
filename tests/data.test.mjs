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
