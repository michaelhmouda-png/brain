const REF = /^[a-z0-9]{20}$/;
const sourceRef = process.env.BACKUP_SOURCE_PROJECT_REF?.trim();
const targetRef = process.env.RESTORE_TARGET_PROJECT_REF?.trim();
const productionRef = process.env.PRODUCTION_PROJECT_REF?.trim();
const sourceUrlValue = process.env.BACKUP_SOURCE_DATABASE_URL;
const targetUrlValue = process.env.RESTORE_TARGET_DATABASE_URL;
if (![sourceRef,targetRef,productionRef].every((value) => value && REF.test(value))) throw new Error('BACKUP_PROJECT_REFERENCE_INVALID');
if (sourceRef !== productionRef) throw new Error('BACKUP_SOURCE_NOT_APPROVED_PRODUCTION');
if (targetRef === productionRef || targetRef === sourceRef) throw new Error('RESTORE_TARGET_MUST_BE_SEPARATE');
if (process.env.RESTORE_TARGET_DISPOSABLE !== 'true') throw new Error('RESTORE_TARGET_NOT_MARKED_DISPOSABLE');
let sourceUrl; let targetUrl;
try { sourceUrl = new URL(sourceUrlValue); targetUrl = new URL(targetUrlValue); } catch { throw new Error('BACKUP_DATABASE_URL_INVALID'); }
const binds = (url, ref) => url.hostname.includes(ref) || decodeURIComponent(url.username).includes(ref);
if (!binds(sourceUrl, sourceRef) || !binds(targetUrl, targetRef)) throw new Error('BACKUP_PROJECT_BINDING_MISMATCH');
if (sourceUrl.href === targetUrl.href) throw new Error('RESTORE_TARGET_MUST_BE_SEPARATE');
console.log('Backup boundary valid: approved source and separate disposable restore target.');
