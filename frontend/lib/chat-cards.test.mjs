import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvent, emptyTranscript } from './transcript.ts';
import { validGoogleClient, GOOGLE_STEPS } from './google-setup.ts';
import { translate } from './i18n.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
const id='a'.repeat(32);
const event=(seq,type,data)=>({seq,type,data,thread_id:1,turn_id:1});
test('question text remains data, answers collapse once, approvals stay separate',()=>{
 const attack='<img src=x onerror=alert(1)> [click](https://evil.test)';
 let state=applyEvent(emptyTranscript(),event(1,'chat.card',{id,kind:'question',question:'Which?',options:[attack,'Other']}));
 state=applyEvent(state,event(2,'approval.requested',{approval_id:'approval',tool:'shell',input:{command:'true'}}));
 assert.equal(state.items[0].options[0],attack);
 const html=renderToStaticMarkup(createElement('button',null,state.items[0].options[0]));
 assert.ok(!html.includes('<img')&&!html.includes('<a '));
 state=applyEvent(state,event(3,'chat.card.answered',{id,answer:attack}));
 state=applyEvent(state,event(4,'chat.card.answered',{id,answer:'overwrite'}));
 assert.equal(state.items[0].answer,attack); assert.equal(state.items[1].status,'pending');
 assert.equal(applyEvent(state,event(4,'chat.card.answered',{id,answer:'duplicate'})),state);
});
test('question choices are bounded and card kind never becomes approval',()=>{
 for(const options of [[],['only'],Array(6).fill('x')]) assert.equal(applyEvent(emptyTranscript(),event(1,'chat.card',{id,kind:'question',options})).items.length,0);
 assert.equal(applyEvent(emptyTranscript(),event(1,'chat.card',{id,kind:'approval',options:['Yes','No']})).items.length,0);
});
test('Google steps use fixed Cloud destinations and require a Web client pair',()=>{
 assert.equal(GOOGLE_STEPS.length,6);
 assert.ok(GOOGLE_STEPS.every(([,url])=>new URL(url).origin==='https://console.cloud.google.com'));
 assert.ok(validGoogleClient('12345-fixture.apps.googleusercontent.com','GOCSPX-'+'a'.repeat(24)));
 for(const [id,secret] of [['AIza-key','abc'],['12345-fixture.apps.googleusercontent.com',''],['<script>','GOCSPX-'+'a'.repeat(24)]]) assert.equal(validGoogleClient(id,secret),false);
 assert.equal(validGoogleClient('',''),false); assert.equal(validGoogleClient('','',true),true);
});
test('Google setup, card controls and app categories have Hebrew copy',()=>{
 for(const key of [...GOOGLE_STEPS.map(([label])=>label),'Your Google project','Client ID','Client secret','Read only','Connect Gmail','Every morning at 8','Bots read freely and ask before changing anything.','Productivity','Communication','Design','Code','Data','Sales','Marketing','Finance','Research','Support']) assert.match(translate('he',key),/[\u0590-\u05ff]/,key);
});

const callData = {id, kind:'call', phone_number:'+13055550100', name:'Restaurant', purpose:'Book a table. Number from the owner.', talking_points:['Table for two at 7.'], details:'Booking name: Alex'};
const parseCall = data => applyEvent(emptyTranscript(), event(1, 'chat.card', data));
import { callHref, normalizeCallNumber, validCallPayload } from './call-card.ts';

test('call card replays all fields and the outcome without changing the number', () => {
  let state = parseCall(callData);
  assert.equal(state.items.length, 1);
  assert.deepEqual(state.items[0], {kind:'chat_card', key:'e1', turnId:1, cardId:id, cardKind:'call', question:'', options:[], provider:'', name:'Restaurant', brief:false, answer:null, phoneNumber:'+13055550100', purpose:callData.purpose, talkingPoints:callData.talking_points, details:callData.details});
  state = applyEvent(state, event(2, 'chat.card.answered', {id, answer:'Done'}));
  assert.equal(state.items[0].answer, 'Done');
  assert.equal(callHref(state.items[0].phoneNumber), 'tel:+13055550100');
  assert.equal(applyEvent(state, event(2, 'chat.card.answered', {id, answer:'Done'})), state);
});

test('client normalizes the same phone syntax and only links normalized event numbers', () => {
  for (const [input, expected] of [['+1 305 555 0100','+13055550100'], ['(305) 555-0100','3055550100'], ['0501234567','0501234567'], ['+1.305.555.0100','+13055550100'], ['1234567','1234567'], ['1'.repeat(15),'1'.repeat(15)]]) {
    assert.equal(normalizeCallNumber(input), expected);
    assert.equal(callHref(expected), `tel:${expected}`);
    if (input !== expected) assert.equal(callHref(input), null);
  }
  for (const input of ['letters', '123', '', '1'.repeat(20), '3055550100;', '3055550100#', '*3055550100', '3055550100,', '3055550100p', '3055550100w', '3055550100P', '3055550100W', '3055550100\n', '3055550100\r', '3055550100\t', '3055550100\0', '++13055550100', '305+5550100', '１２３４５６７', ' '.repeat(65)+'3055550100', null, 3055550100]) {
    assert.equal(normalizeCallNumber(input), null, JSON.stringify(input));
    assert.equal(callHref(input), null);
  }
});

test('invalid call payloads are rejected without truncating or dropping individual points', () => {
  for (const field of ['phone_number', 'name', 'purpose', 'talking_points']) {
    const data = {...callData}; delete data[field];
    assert.equal(parseCall(data).items.length, 0, field);
  }
  for (const points of [[], Array(7).fill('x'), ['x', null], 'Ask', [''], [' '.repeat(3)]]) assert.equal(parseCall({...callData, talking_points:points}).items.length, 0);
  for (const [field, limit] of [['name',80], ['purpose',200], ['talking_points',160], ['details',300]]) {
    const value = text => ({...callData, [field]:field === 'talking_points' ? [text] : text});
    assert.equal(validCallPayload(value('x'.repeat(limit))), true);
    assert.equal(validCallPayload(value('\u{20000}'.repeat(limit))), true);
    for (const text of ['x'.repeat(limit+1), null, 4, 'a\nb', 'a\tb', 'a\0b', 'a\x7fb', 'a\x85b', 'a\u202eb', 'a\u200bb', 'a\ud800b']) assert.equal(parseCall(value(text)).items.length, 0, field);
  }
  const withoutDetails = {...callData}; delete withoutDetails.details;
  assert.equal(parseCall(withoutDetails).items.length, 1);
  assert.equal(parseCall({...callData, details:''}).items.length, 1);
});

// Compile the actual component with the installed TypeScript compiler. Only its
// app context and unrelated integration components are substituted for this unit test.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as callHelpers from './call-card.ts';
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../components/chat/ChatCard.tsx', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}}).outputText;
const componentModule = {exports:{}};
const stubs = {
  '@/lib/api':{request:() => {throw new Error('Rendering a call must not make an API request');}},
  '@/lib/call-card':callHelpers,
  '@/lib/use-i18n':{useT:() => key => translate('en', key)},
  '@/components/AuthGate':{useSession:() => ({session:{scopes:['admin','chat']}})},
  './items':{},
  '@/components/ui/Button':{Button:({children, ...props}) => { delete props.variant; delete props.size; return createElement('button', props, children); }},
  '@/components/ui/Dialog':{}, '@/components/LocalApps':{}, '@/lib/local-apps-catalog':{},
};
new Function('require', 'module', 'exports', compiled)(name => name in stubs ? stubs[name] : require(name), componentModule, componentModule.exports);
const renderCall = item => renderToStaticMarkup(createElement(componentModule.exports.ChatCard, {item, threadId:1, running:false}));

test('call component renders escaped text, a dialer anchor, copy and optional outcomes', () => {
  const attack = '<img src=x onerror=alert(1)> [link](https://evil.test)';
  const item = parseCall({...callData, name:attack, purpose:attack, talking_points:[attack], details:attack}).items[0];
  const html = renderCall(item);
  assert.ok(!html.includes('<img') && !html.includes('href="https:'));
  assert.equal((html.match(/&lt;img/g) || []).length, 4);
  assert.match(html, /href="tel:\+13055550100"/);
  for (const text of ['Copy number', 'Done', 'Didn’t reach them', '+1 (305) 555-0100']) assert.ok(html.includes(text), text);
  assert.match(html, /min-h-11/);
  const answered = renderCall({...item, answer:'Done'});
  assert.match(answered, /data-testid="answered-card"/);
  assert.match(answered, /href="tel:\+13055550100"/);
  assert.ok(!answered.includes('Didn’t reach them'));
});

test('invalid or non-normalized event numbers never produce Call or Copy controls', () => {
  for (const number of ['911', '3055550100;1', '3055550100#', '3055550100,1', '3055550100p', '3055550100w', '1'.repeat(20), '+1 305 555 0100']) {
    const item = parseCall({...callData, phone_number:number}).items[0];
    assert.equal(callHref(item.phoneNumber), null);
    const html = renderCall(item);
    assert.ok(!html.includes('href=') && !html.includes('Copy number'));
    assert.ok(html.includes('Invalid phone number.'));
  }
  assert.ok(!renderCall({...parseCall(callData).items[0], phoneNumber:'3055550100\n'}).includes('href='));
});

test('call controls have English and Hebrew copy', () => {
  for (const key of ['Prepared call', 'Call', 'Copy number', 'Details to give', 'Done', "Didn’t reach them", 'Opens your phone’s dialer. You place the call and talk.', 'Could not copy the number. Select it and copy.', 'Invalid phone number. Ask the bot to prepare the card again.']) {
    assert.equal(translate('en', key), key);
    assert.match(translate('he', key), /[\u0590-\u05ff]/);
  }
});
