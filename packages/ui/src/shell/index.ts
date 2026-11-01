// The server shell both web apps render (plan 2.8, ADR-0038 bullet 5). Client pieces have their own
// entry points: `@eeasy-logistics/ui/shell/locale-switch`.
export { localeCookie } from './locale-cookie';
export { requestLocale } from './locale';
export { RootHtml, rootMetadata } from './root-html';
