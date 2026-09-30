# Firebase — Produção

Projeto oficial: `delivery-pizzaria-f5b08`.

Este documento é o checklist de entrada em produção. O código deve passar em
`node scripts/production-preflight.mjs` antes de qualquer deploy.

## 1. Pré-requisitos externos

No Firebase Console:

1. Ativar faturamento/Blaze antes de publicar Cloud Functions de produção.
2. Confirmar o Cloud Firestore ativo no projeto correto.
3. Em Authentication, habilitar:
   - E-mail/Senha;
   - Google.
4. Em Authentication > Settings > Authorized domains, manter/adicionar:
   - `delivery-pizzaria-f5b08.web.app`;
   - `delivery-pizzaria-f5b08.firebaseapp.com`;
   - `pizzaria.guiasys.online` como domínio público de produção;
   - `guiasys.online` se esse domínio continuar sendo usado;
   - o domínio final da pizzaria quando ele for conectado.
5. Configurar uma política de senha compatível com o sistema. O cliente exige
   pelo menos 8 caracteres com letra e número; funcionários exigem 10 ou mais
   caracteres com letra e número no backend.
6. Criar alertas de orçamento no Google Cloud/Firebase antes da abertura ao público.

## 2. Secret para upload de imagens

Os uploads de produtos e da logo continuam sendo gravados no repositório GitHub
e passam a salvar uma URL pública versionada, portanto ficam disponíveis no site
Firebase imediatamente sem aguardar um novo deploy de Hosting.

Criar um token fine-grained do GitHub restrito ao repositório
`guiasysstudio/Delivery-Pizzaria`, com somente `Contents: Read and write`.

Depois:

```powershell
firebase functions:secrets:set DELIVERY_GITHUB_TOKEN --project delivery-pizzaria-f5b08
```

Nunca gravar esse token no repositório, no Firestore ou no JavaScript do navegador.

## 3. Preflight local

No diretório raiz:

```powershell
node scripts/production-preflight.mjs
```

O preflight valida:

- project ID do Firebase;
- Node 22 nas Functions;
- versões de dependências fixadas;
- exports obrigatórios das Functions;
- CORS dos domínios Firebase;
- Firebase Hosting isolado dos fontes privados;
- rewrites de API;
- arquivos públicos necessários;
- ausência de `functions/`, testes, regras, scripts e Print Agent no bundle público.

## 4. Deploy controlado

No Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-production.ps1
```

O script publica de uma vez:

- Firestore Rules;
- Firestore indexes e políticas TTL;
- Cloud Functions;
- Firebase Hosting.

Comando equivalente:

```powershell
firebase deploy --project delivery-pizzaria-f5b08 --only "firestore:rules,firestore:indexes,functions,hosting"
```

Não publicar somente as Rules antes das Functions novas. Algumas regras bloqueiam
fallbacks antigos e dependem das Functions server-side.

## 5. Retenção técnica automática

As coleções temporárias usam `expiresAt` e políticas TTL:

- `orderRequests`: 7 dias;
- `cashOperationRequests`: 7 dias;
- `orderRateLimits`: 24 horas.

Esses documentos existem para idempotência/rate-limit e não devem crescer
indefinidamente. Pedidos e registros financeiros não usam esse TTL.

## 6. Teste pós-deploy

Primeiro validar o domínio padrão do Firebase:

```powershell
node scripts/smoke-production.mjs https://delivery-pizzaria-f5b08.web.app
```

O smoke test confere:

- Home;
- Aviso de Privacidade;
- ADM;
- Minha Conta;
- rewrite `/api/health`;
- resposta controlada da API de criação de pedido.

Depois fazer teste manual completo:

1. login Master;
2. login de funcionário operacional;
3. cadastro/login de cliente;
4. endereço;
5. pedido;
6. abertura de caixa;
7. aceite/preparo/entrega;
8. conclusão vinculada ao caixa;
9. fechamento;
10. impressão;
11. exclusão/anonimização de uma conta de teste.

## 7. Migrações de privacidade

No primeiro acesso Master após as Functions novas estarem publicadas, o ADM tenta
executar as migrações de privacidade pendentes. Conferir os logs das Functions:

- `migrateCustomerPrivacy`;
- `migrateOrderPrivacy`.

Se houver conflito de CPF em dado legado, a migração não deve ser marcada como
concluída até o conflito ser analisado.

## 8. Domínio personalizado

Somente conectar o domínio final depois que o `.web.app` passar no smoke test.

Ao conectar um domínio novo:

1. adicionar o domínio em Firebase Authentication > Authorized domains;
2. testar Google Login e E-mail/Senha;
3. testar todas as chamadas de Functions;
4. testar o Print Agent nesse novo Origin;
5. repetir o smoke e o fluxo manual.

O Print Agent possui sua própria lista de Origins permitidos; essa validação faz
parte do Módulo 5.

## 9. Rollback

Em caso de falha:

- Hosting: usar o histórico de releases do Firebase Hosting ou republicar o commit
  estável anterior;
- código/Rules/Functions: voltar o Git para o commit estável e executar novamente
  o deploy completo;
- nunca restaurar regras antigas isoladamente se o backend atual depender das
  novas regras.

## 10. Critério para liberar ao cliente

Não considerar produção aprovada até existirem, simultaneamente:

- CI verde no commit do `main`;
- preflight verde;
- deploy Firebase concluído sem erro;
- smoke test verde no domínio Firebase;
- teste real de pedido + caixa + impressão;
- Authentication configurado e domínio autorizado;
- orçamento/alertas configurados.
