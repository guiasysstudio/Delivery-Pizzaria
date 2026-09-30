import { readFile } from 'node:fs/promises';

const read=path=>readFile(path,'utf8');
const fail=message=>{ throw new Error('[module5] '+message); };
const must=(condition,message)=>{ if(!condition) fail(message); };

const [
  project,
  program,
  installer,
  uninstaller,
  agentReadme,
  versionText,
  adminJs,
  adminHtml,
  workflow,
  manifestText,
  serviceWorker,
  indexHtml,
  robots,
  sitemap,
  bat,
  hostingBuild,
  firebaseText,
  backend,
  preflight,
  offline
]=await Promise.all([
  read('print-agent/DeliveryPizzaria.PrintAgent.csproj'),
  read('print-agent/Program.cs'),
  read('print-agent/Instalar.cmd'),
  read('print-agent/Desinstalar.cmd'),
  read('print-agent/README.md'),
  read('assets/print-agent-version.json'),
  read('admin/admin.js'),
  read('admin/index.html'),
  read('.github/workflows/build-print-agent.yml'),
  read('manifest.webmanifest'),
  read('service-worker.js'),
  read('index.html'),
  read('robots.txt'),
  read('sitemap.xml'),
  read('abrir-admin-impressao.bat'),
  read('scripts/build-hosting.mjs'),
  read('firebase.json'),
  read('functions/index.js'),
  read('scripts/production-preflight.mjs'),
  read('offline.html')
]);

const version=project.match(/<Version>([^<]+)<\/Version>/)?.[1]?.trim();
must(/^\d+\.\d+\.\d+$/.test(version||''),'versão SemVer do Agent ausente');
const versionInfo=JSON.parse(versionText);
must(versionInfo.latestVersion===version,'latestVersion diferente do csproj');
must(versionInfo.minimumVersion===version,'minimumVersion deve exigir a versão endurecida atual');
must(versionInfo.downloadUrl.includes('/print-agent-v'+version+'/'),'downloadUrl não usa tag versionada');
must(program.includes('Version = "'+version+'"'),'AgentInfo fora de sincronia');
must(installer.includes('Print Agent '+version),'instalador fora de sincronia');
must(uninstaller.includes('Print Agent '+version),'desinstalador fora de sincronia');
must(agentReadme.includes('`'+version+'`'),'README do Agent fora de sincronia');
must(adminJs.includes("FALLBACK_PRINT_AGENT_VERSION='"+version+"'"),'fallback do ADM fora de sincronia');
must(adminJs.includes('/print-agent-v'+version+'/'),'download fallback do ADM não é versionado');
must(adminHtml.includes('/print-agent-v'+version+'/'),'download inicial do ADM não é versionado');
must(workflow.includes('$tag = "print-agent-v$version"'),'workflow não publica tag versionada');
must(!workflow.includes('print-agent-latest'),'workflow ainda publica alias não versionado');

for(const token of [
  'MaxRequestBodyBytes = 128 * 1024',
  'MaxPrintTextLength = 64_000',
  'origin_required',
  'print_text_too_large',
  '_app.StartAsync(_cts.Token)',
  'AllowedLocalDevPorts',
  'pizzaria.guiasys.online'
]) must(program.includes(token),'hardening do Agent ausente: '+token);
must(!program.includes('host.EndsWith(".guiasys.online"'),'Agent ainda aceita wildcard de subdomínio');
must(!program.includes('guiasysstudio.github.io'),'Agent ainda aceita GitHub Pages como origem');
must(installer.includes('Invoke-RestMethod')&&installer.includes('/health'),'instalador não valida a porta/health do Agent');
must(installer.includes('Authenticode'),'instalador não documenta limitação de assinatura');

const manifest=JSON.parse(manifestText);
must(manifest.id==='/'&&manifest.start_url==='/'&&manifest.scope==='/','manifesto PWA não está ancorado no domínio raiz');
must(serviceWorker.includes("const OFFLINE_URL='./offline.html'"),'fallback offline ausente');
must(serviceWorker.includes("url.pathname.startsWith('/api/')"),'service worker pode cachear API');
must(serviceWorker.includes("print-agent-version.json"),'service worker não trata versão do Agent');
must(serviceWorker.includes('networkFirst(req,OFFLINE_URL)'),'navegação sem fallback offline');
must(offline.includes('Você está offline'),'página offline inválida');
for(const file of ['offline.html','robots.txt','sitemap.xml']) must(hostingBuild.includes("'"+file+"'"),'Hosting não inclui '+file);

const firebase=JSON.parse(firebaseText);
const headerMap=new Map((firebase.hosting?.headers||[]).map(x=>[x.source,x.headers]));
must(headerMap.has('assets/print-agent-version.json'),'Hosting sem header do manifesto do Agent');
must(JSON.stringify(headerMap.get('assets/print-agent-version.json')).includes('no-store'),'manifesto do Agent pode ficar cacheado');

const productionDomain='https://pizzaria.guiasys.online';
for(const [name,text] of [
  ['index.html',indexHtml],
  ['robots.txt',robots],
  ['sitemap.xml',sitemap],
  ['abrir-admin-impressao.bat',bat],
  ['functions/index.js',backend]
]){
  must(!text.includes('guiasysstudio.github.io/Delivery-Pizzaria'),name+' ainda referencia URL antiga do GitHub Pages');
}
must(indexHtml.includes(productionDomain+'/'),'canonical/OpenGraph não usam domínio de produção');
must(robots.includes('Sitemap: '+productionDomain+'/sitemap.xml'),'robots não usa sitemap de produção');
must(sitemap.includes('<loc>'+productionDomain+'/</loc>'),'sitemap não usa domínio de produção');
must(bat.includes(productionDomain+'/admin/'),'atalho do ADM não usa domínio de produção');
must(backend.includes('"'+productionDomain+'"'),'CORS das Functions sem domínio de produção');
must(!backend.includes('guiasysstudio.github.io'),'CORS das Functions ainda aceita GitHub Pages');
must(preflight.includes(productionDomain),'preflight não valida domínio de produção');

console.log('Module 5 Print Agent/PWA/publication OK: '+version);
