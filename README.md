# Delivery Pizzaria

Sistema web completo de delivery para pizzaria, com experiência de cliente, operação em tempo real, controle financeiro, fidelidade, perfis de acesso configuráveis e impressão automática no Windows.

## Aplicações

- Site público: cardápio, conta, endereços, carrinho e checkout.
- Minha Conta: dados, endereços, pedidos, cupons e favoritos.
- Central Delivery: operação administrativa da pizzaria.
- Print Agent: ponte local entre o navegador e qualquer impressora instalada no Windows.
- Firebase Functions: serviços confiáveis para automações que não podem expor credenciais no navegador.

## Cliente

- Login Google ou e-mail/senha.
- Recuperação de senha.
- Vários endereços salvos.
- Endereço principal e troca rápida.
- CEP com preenchimento automático.
- Cardápio por categorias.
- Busca.
- Destaques e promoções.
- Pizzas com tamanhos.
- Meio a meio.
- Adicionais e bordas.
- Observação por item.
- Favoritos.
- Carrinho persistente.
- Entrega ou retirada.
- Taxa de entrega por bairro.
- Área de atendimento configurável.
- Pedido mínimo.
- Horário automático ou abertura/fechamento forçado.
- PWA instalável no celular.
- Navegação inferior otimizada para celular.
- Histórico de pedidos.
- Acompanhamento de status.
- Pedir novamente.
- Carteira de cupons conquistados.

## Interface e identidade visual

- Ícones SVG locais baseados em Lucide, sem dependência de CDN.
- Toasts internos para sucesso, aviso, informação e erro.
- Modais de confirmação próprios para ações destrutivas.
- Skeletons de carregamento e estados vazios orientativos.
- Navegação por teclado com `focus-visible`.
- Áreas de toque ampliadas para celular.
- Mensagens dinâmicas preparadas para leitores de tela.
- Cor principal configurável por pizzaria.
- Logo personalizada.
- Imagem/banner de destaque opcional.
- Favicon e pacote PWA local.
- Respeito a `prefers-reduced-motion`.

A licença dos ícones está armazenada em `assets/icons/LICENSE-LUCIDE.txt`.

## Pagamento

O sistema não realiza pagamento online.

O cliente escolhe como irá pagar no recebimento/retirada:

- Dinheiro.
- PIX.
- Débito.
- Crédito.
- Outras formas cadastradas pela pizzaria.

No dinheiro, o cliente informa se precisa de troco e o valor que entregará. A comanda mostra o valor do troco que o estabelecimento precisa levar.

## Promoções

A Central Delivery permite cadastrar promoções com:

- porcentagem ou valor fixo;
- aplicação em todo o cardápio, categoria ou produto;
- início e fim;
- ativação/desativação.

O site exibe preço original e promocional e grava o snapshot da promoção no pedido para conferência operacional.

## Cupons e fidelidade

Cupons podem ter:

- desconto percentual ou fixo;
- pedido mínimo;
- desconto máximo;
- quantidade mínima de pedidos concluídos;
- valor mínimo já gasto;
- período de validade;
- entrega automática ao cliente ao atingir as regras.

A entrega automática é executada por Firebase Function quando um pedido muda para Concluído. O cliente recebe o benefício em **Minha Conta > Cupons**.

## Central Delivery

Áreas:

- Pedidos.
- Caixa.
- Produtos.
- Categorias.
- Promoções.
- Cupons.
- Clientes.
- Impressão.
- Usuários.
- Perfis de acesso.
- Configurações.

O dashboard mostra operação em tempo real, pedidos do dia e faturamento concluído do dia.

### Pedidos

Fluxo:

1. Aguardando confirmação.
2. Confirmado.
3. Em preparo.
4. Pronto.
5. Saiu para entrega.
6. Concluído.
7. Cancelado.

A lista possui ações rápidas para avançar o pedido sem abrir o detalhe e rolar a tela.

A Central Delivery recalcula preços do pedido com o cardápio atual antes de aceitar/imprimir e sinaliza divergências.

### Produtos

O editor usa campos guiados:

- nome;
- categoria;
- descrição;
- preço base;
- ordem de exibição;
- tamanhos (Nome + Preço);
- adicionais/bordas (Nome + Preço);
- pizza/meio a meio;
- disponibilidade;
- destaque.

Não é necessário digitar separadores como `Nome|Preço`.

### Imagens de produtos

O editor possui:

- seleção de imagem local;
- recorte 4:3;
- zoom;
- reposicionamento por arraste;
- geração WebP;
- download local como fallback;
- envio seguro ao GitHub via Firebase Function.

Destino no repositório:

```text
assets/products/
```

O token do GitHub nunca é colocado no JavaScript do navegador.

## Frete e área de entrega

A Central Delivery permite escolher três formas de cobrança do motoboy:

- **Valor fixo** — uma taxa única para qualquer entrega.
- **Por bairro** — cada bairro recebe uma taxa própria, com opção de bloquear bairros não cadastrados.
- **Por km** — faixas do tipo “até X km = R$ Y”, com opção de bloquear entregas acima da última faixa.

No modo por km:

- o ADM informa o CEP da pizzaria;
- endereços dos clientes recebem coordenadas a partir do CEP;
- o sistema calcula uma distância aproximada entre os CEPs;
- a faixa correspondente define a taxa;
- o pedido grava modo, distância aproximada e valor do frete;
- a comanda mostra o tipo de cálculo e, quando aplicável, a distância.

A geolocalização por CEP usa BrasilAPI CEP v2 quando disponível e mantém ViaCEP como fallback para dados de endereço. Para distância exata seguindo ruas/rotas, será necessário conectar um provedor de mapas/rotas por backend.

## Caixa e financeiro

O caixa permite:

- abertura com valor inicial;
- observação da abertura;
- uma sessão global aberta por vez;
- resumo de pedidos concluídos;
- vendas totais;
- dinheiro;
- PIX;
- débito;
- crédito;
- suprimentos de caixa;
- sangrias;
- fechamento com dinheiro contado;
- valor esperado considerando abertura + vendas em dinheiro + suprimentos − sangrias;
- diferença de caixa;
- observação e histórico.

A abertura usa transação para evitar dois caixas abertos simultaneamente por computadores diferentes.

## Perfis e permissões

Na área **Usuários**, quem possui permissão de gerenciamento pode editar usuários e, pelas ações da lista:

- ativar ou desativar o acesso;
- trocar a senha;
- excluir a conta interna;
- editar nome e perfil de acesso.

Ativar/desativar, trocar senha e excluir passam pela Firebase Function `manageStaffUser`, mantendo Firestore e Firebase Authentication sincronizados. A própria conta não pode ser desativada/excluída e o último Master ativo é protegido.

O Master pode criar perfis próprios e escolher permissões individualmente, incluindo:

- visualizar/aceitar/preparar/despachar/concluir/cancelar pedidos;
- visualizar/cadastrar/editar/excluir produtos;
- gerenciar categorias;
- promoções;
- cupons;
- clientes;
- impressão;
- caixa;
- configurações;
- usuários;
- perfis.

Perfis padrão são criados automaticamente quando necessário:

- Gerente.
- Caixa.
- Cozinha.
- Entrega.
- Operador.

O Master continua sendo o nível máximo e não pode ser criado/elevado por um usuário não-Master.

## Cardápio demonstrativo

O botão de cardápio demonstrativo completa, sem duplicar nomes já existentes, um conjunto com mais de 20 itens:

- pizzas salgadas;
- pizzas doces;
- bebidas;
- combos.

Pizzas doces do exemplo não recebem adicionais/bordas e não permitem meio a meio.

## Print Agent do Windows

O **Delivery Pizzaria Print Agent** roda apenas no computador da pizzaria e conversa com a Central Delivery em:

```text
http://127.0.0.1:17329
```

Recursos (Print Agent 1.7.0):

- detecta impressoras instaladas no Windows;
- recupera automaticamente a impressora quando a selecionada foi removida ou renomeada;
- imprime diretamente pela fila do Windows;
- seleção de impressora por estação no próprio Agent;
- modelos físicos para térmica 80 mm, térmica 58 mm, A4, compacto e etiqueta;
- tamanho de papel, margens e fonte ajustados por modelo;
- impressão da logo da pizzaria nos modelos compatíveis;
- impressão de teste;
- impressão automática;
- instância única para impedir duas cópias disputando a porta local;
- janela de configuração ao clicar no ícone da bandeja;
- iniciar com o Windows;
- início automático habilitado no primeiro uso;
- identidade visual própria;
- instalador/desinstalador por usuário.

Pacote estável:

```text
https://github.com/guiasysstudio/Delivery-Pizzaria/releases/download/print-agent-v1.7.0/DeliveryPizzaria-PrintAgent-win-x64.zip
```

Use `Instalar.cmd` dentro do pacote para instalar em `%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent`.

## Firebase

Projeto:

```text
delivery-pizzaria-f5b08
```

O ambiente de produção usa Cloud Firestore, Cloud Functions v2 e Firebase Hosting.
O procedimento completo está em `docs/FIREBASE_PRODUCTION.md`.

Antes de publicar:

```powershell
node scripts/production-preflight.mjs
```

Deploy controlado no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-production.ps1
```

O deploy publica em conjunto:

- Firestore Rules;
- índices e políticas TTL;
- Cloud Functions;
- Firebase Hosting.

O Hosting é montado em `.firebase-hosting/` por allowlist. Fontes internos como
`functions/`, Rules, testes, scripts e Print Agent não são enviados ao site.

### Authentication

Habilitar E-mail/Senha e Google. Os domínios padrão do Firebase Hosting e o
domínio final da pizzaria devem constar em **Authorized domains**.

### Firebase Functions

Entre as funções server-side estão:

- `backendHealth`;
- `createOrder`;
- `manageCash`;
- `customerIdentity`;
- `cancelCustomerOrder`;
- `deleteCustomerAccount`;
- `resolveStaffLogin`;
- `manageStaffUser`;
- `manageStaffRole`;
- `staffOrderPrivate`;
- `migrateCustomerPrivacy`;
- `migrateOrderPrivacy`;
- `uploadProductImage`;
- `uploadStoreLogo`;
- `grantLoyaltyCoupons`.

Uploads de produto/logo usam o secret `DELIVERY_GITHUB_TOKEN`, que deve ser um
token fine-grained limitado ao repositório e a **Contents: Read and write**.
O secret nunca deve ser colocado no JavaScript do navegador.

Os documentos transitórios usados para idempotência e rate limit possuem TTL,
evitando crescimento indefinido do Firestore.

Após o deploy:

```powershell
node scripts/smoke-production.mjs https://delivery-pizzaria-f5b08.web.app
```

As Rules bloqueiam os caminhos antigos inseguros. Portanto Functions, Rules e
Hosting devem ser publicados como uma unidade, e não em etapas incompatíveis.

### Criação segura de pedidos

O site público usa exclusivamente a Function `createOrder`. Ela ignora valores calculados no navegador e recalcula no servidor:

- produtos e disponibilidade;
- tamanho e meio a meio;
- adicionais;
- promoções e snapshot histórico;
- cupom e elegibilidade;
- pedido mínimo;
- forma de pagamento e troco;
- frete fixo, por bairro ou por km;
- contador sequencial do pedido.

Não existe mais fallback de gravação direta pelo navegador. Se a Function segura estiver indisponível, o pedido não é gravado e o cliente recebe uma mensagem para tentar novamente.

## Validação automática

O workflow **Validate Delivery Pizzaria** verifica:

- sintaxe JavaScript do site, conta, Central Delivery, service worker e Functions;
- seletores com risco de erro `$().forEach`;
- referências de IDs entre JavaScript e HTML;
- IDs HTML duplicados;
- manifesto PWA;
- guardrails de UI profissional: sem `alert()/confirm()` nativos, sem emojis na interface, botões com `type` explícito e SVGs locais válidos;
- arquivos obrigatórios.

O workflow **Build Print Agent** compila o Windows x64 e publica uma release versionada, mantendo a versão do executável, manifesto e tag sincronizadas.

O domínio público é `https://pizzaria.guiasys.online/`. O deploy de produção é feito pelo Firebase Hosting após o preflight e os testes automáticos; a branch `main` permanece como fonte do código.


## Módulo 5 — Print Agent, PWA e publicação

O Print Agent 1.7.0 limita origens e payloads de impressão, detecta falha ao abrir a porta local 17329 e valida o serviço após a instalação. O pacote continua sem assinatura Authenticode, portanto o Windows pode exibir SmartScreen ou aviso de fornecedor desconhecido na primeira execução.

O PWA possui fallback offline dedicado, evita cache de rotas `/api/` e força consulta fresca do manifesto de versão do Print Agent. Canonical, OpenGraph, sitemap, robots e atalhos de operação usam o domínio `pizzaria.guiasys.online`.
