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
