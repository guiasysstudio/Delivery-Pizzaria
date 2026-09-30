$ErrorActionPreference = "Stop"

$Project = "delivery-pizzaria-f5b08"

Write-Host "== Delivery Pizzaria: preflight =="
node scripts/production-preflight.mjs
if ($LASTEXITCODE -ne 0) { throw "Preflight falhou." }

if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw "Firebase CLI não encontrado. Instale/atualize com: npm i -g firebase-tools@15.28.2"
}

Write-Host "== Firebase CLI =="
firebase --version

Write-Host "== Deploy produção =="
firebase deploy --project $Project --only "firestore:rules,firestore:indexes,functions,hosting"
if ($LASTEXITCODE -ne 0) { throw "Firebase deploy falhou." }

Write-Host ""
Write-Host "Deploy concluído. Agora rode:"
Write-Host "node scripts/smoke-production.mjs https://$Project.web.app"
