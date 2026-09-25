/**
 * Every domain file of messages, by name. `index.ts` merges them; the dictionary
 * test checks that nothing here is missing from the merge and that no key is
 * defined twice.
 */
export { app } from "./app";
export { campaigns } from "./campaigns";
export { common } from "./common";
export { contacts } from "./contacts";
export { dashboard } from "./dashboard";
export { email } from "./email";
export { editor } from "./editor";
export { errors } from "./errors";
export { pages } from "./pages";
export { settings } from "./settings";
export { wizard } from "./wizard";
export { labels } from "./labels";
export { status } from "./status";
// The developer test panel's words (testhelp, testpanel, testguide) are deliberately not listed here:
// `index.ts` imports them by name, so a production build can leave them out.
