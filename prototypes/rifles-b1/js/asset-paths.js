/* Shared graphics stay in arch062/ (read only). Paths are relative to the page, so the same
 * build works under any site prefix (GitHub Pages project path) and at the root of a local server.
 * The page must be opened as a directory: .../prototypes/rifles-b1/ */
const ARCH062_BASE='../../arch062/';
function arch062Asset(relativePath){return ARCH062_BASE+relativePath}
