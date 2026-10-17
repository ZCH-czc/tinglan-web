/** Browser host functions retain the Window receiver when injected into controllers. */
export const hostFetch=(...args)=>globalThis.fetch(...args);
export const hostSetTimeout=(...args)=>globalThis.setTimeout(...args);
export const hostClearTimeout=(...args)=>globalThis.clearTimeout(...args);
