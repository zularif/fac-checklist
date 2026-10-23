import 'fake-indexeddb/auto'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'')
globalThis.window=new EventTarget()
Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true})
globalThis.localStorage={getItem:()=>null,setItem:()=>{}}
let user='user-a', mode='ok',calls=0
const receipts=new Map()
globalThis.mockDb={auth:{getSession:async()=>({data:{session:{user:{id:user}}}})},rpc:async(_name,{p})=>{calls++;if(mode==='network')return {error:{message:'Failed to fetch'}};if(mode==='error')return {error:{message:'This inspection has changed. Reopen it.'}};if(!receipts.has(p.request_id))receipts.set(p.request_id,{inspectionId:'inspection-'+receipts.size,revision:1});return {data:receipts.get(p.request_id)}}}
const local=await import(pathToFileURL(`${root}/src/lib/localStore.js`))
let code=await fs.readFile(`${root}/src/lib/offlineQueue.js`,'utf8')
code=code.replace("import { db } from './db'",'const db=globalThis.mockDb').replace("'./localStore'",JSON.stringify(pathToFileURL(`${root}/src/lib/localStore.js`).href))
const queue=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
queue.setSyncUser(user)
const draftKey=`draft:${user}:equipment:EQ1:new`
await local.localPut(draftKey,{form:{values:{Pressure:'5'}},route:'/checklist/EQ1'})
assert.equal((await local.localList(`draft:${user}:`)).length,1)
const result=await queue.submitInspection({request_id:crypto.randomUUID(),kind:'equipment',label:'EQ1',draftKey,details:[]})
assert.equal(result.queued,true);assert.equal(calls,0)
assert.equal((await local.localList(`draft:${user}:`)).length,0)
assert.equal((await queue.queueItems(user))[0].state,'queued')
console.log('PASS: durable offline draft-to-outbox transition')
navigator.onLine=true;mode='network';await queue.flushQueue()
assert.equal((await queue.queueItems(user)).length,1)
assert.equal((await queue.queueItems(user))[0].state,'queued')
console.log('PASS: failed connection keeps one queued record')
mode='ok';await Promise.all([queue.flushQueue(),queue.flushQueue()])
assert.equal(receipts.size,1);assert.equal((await queue.queueItems(user))[0].state,'synced')
console.log('PASS: simultaneous retries produce one delivery')
user='user-b';queue.setSyncUser(user)
assert.equal((await queue.queueItems()).length,0)
mode='error';const failed=await queue.submitInspection({request_id:crypto.randomUUID(),kind:'equipment',details:[]})
assert.equal(failed.needsAttention,true)
const before=calls;await queue.flushQueue();assert.equal(calls,before)
console.log('PASS: another account cannot see/send the queue; permanent errors stop automatic retries')
// New queued work is not overwritten by a flush that started earlier.
navigator.onLine=false;await queue.submitInspection({request_id:crypto.randomUUID(),kind:'fe',details:[]})
navigator.onLine=true;mode='ok';await queue.flushQueue()
assert.equal((await queue.queueItems()).length,2)
assert.equal((await queue.queueItems()).filter(x=>x.state==='synced').length,1)
console.log('PASS: FE uploads use the same queue and preserve other records')
const model=await import(pathToFileURL(`${root}/src/lib/inspectionModel.js`))
assert.equal(model.statusFor({type:'numeric',min_value:0,max_value:10},''),'Not checked')
assert.equal(model.statusFor({type:'numeric',min_value:0,max_value:10},'50'),'OutOfRange')
assert.match(model.validateAnswers([{parameter_name:'Condition',type:'multichoice',options:'Good,Bad',required:true}],{}),/required/)
console.log('PASS: blank required checks cannot silently pass')
