/** Apply only after durable persistence succeeds; callers retain drafts on errors. */
export async function commitSettings<T>(draft:T, expected:T, read:()=>Promise<T>, persist:(value:T)=>Promise<void>):Promise<T>{
 if(JSON.stringify(await read())!==JSON.stringify(expected))throw Error('Settings changed elsewhere. Close and reopen Settings before saving.');
 await persist(draft);
 return draft;
}
