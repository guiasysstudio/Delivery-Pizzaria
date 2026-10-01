# Demonstração no Spark x recursos que exigem Blaze

Esta matriz descreve o estado do Delivery Pizzaria antes do deploy definitivo das Firebase Cloud Functions.

## O que funciona sem Blaze

O plano Spark continua suficiente, dentro das cotas do Firebase, para:

- Firebase Authentication com Google e e-mail/senha;
- recuperação de senha e verificação de e-mail;
- leitura e gravação no Cloud Firestore permitidas pelas regras;
- cardápio, categorias, produtos, promoções e configurações;
- dados básicos do cliente, endereços e favoritos;
- carrinho e PWA;
- consulta de CEP via BrasilAPI/ViaCEP;
- som e notificações locais do navegador;
- Print Agent local e impressão de teste;
- edição de dados da pizzaria que não dependa de upload secreto;
- cadastro e edição dos documentos de cupom.

Na demonstração em GitHub Pages/localhost, quando o backend seguro de pedidos não estiver publicado, o checkout cria um **pedido local de demonstração**, válido por 24 horas apenas naquele navegador. O ADM no mesmo navegador recebe esse pedido e permite movimentar seu status. O comprovante e a impressão local também reconhecem pedidos de demonstração.

## Recursos server-side que exigem Blaze no projeto atual

Cloud Functions for Firebase exige Blaze. As funções do repositório são:

| Function | Uso | Demonstração sem Blaze |
| --- | --- | --- |
| `backendHealth` | health check do backend | não é necessária para demonstrar o site |
| `createOrder` | criação segura, preço server-side, contador, idempotência e rate limit | pedido local de demonstração |
| `customerIdentity` | CPF único, hash e dados privados | fallback local guarda somente CPF mascarado; validação real fica pendente |
| `cancelCustomerOrder` | cancelamento seguro de pedido real | pedido local de demonstração pode ser cancelado localmente |
| `deleteCustomerAccount` | exclusão/anônimização + Firebase Admin Auth | não simulado; UI informa que requer Blaze |
| `manageCash` | livro financeiro, caixa, sangria, suprimento e conclusão financeira | não simulado; UI informa que requer Blaze |
| `grantLoyaltyCoupons` | concessão automática ao concluir pedido | cadastro de cupom funciona; concessão automática aguarda Blaze |
| `resolveStaffLogin` | resolve usuário administrativo sem expor mapeamento | login Master mantém ponte compatível; produção usa Function |
| `manageStaffUser` | criar/desativar/excluir usuário e trocar senha | não simulado; UI informa que requer Blaze |
| `manageStaffRole` | gravar/semear perfis administrativos | leitura funciona; alterações seguras aguardam Blaze |
| `staffOrderPrivate` | libera PII de pedido conforme permissão | pedido local já possui snapshot local; pedidos reais precisam da Function |
| `migrateOrderPrivacy` | migração administrativa de PII de pedidos | manutenção, não necessária na demonstração |
| `migrateCustomerPrivacy` | migração administrativa de PII de clientes | manutenção, não necessária na demonstração |
| `uploadProductImage` | upload ao GitHub com token mantido no servidor | editor/recorte funciona e a imagem pode ser baixada manualmente |
| `uploadStoreLogo` | upload de logo ao GitHub com segredo server-side | demais dados da loja funcionam; upload automático aguarda Blaze |

## Notificações

O som de novo pedido e a Web Notification do navegador **não exigem Blaze**. Firebase Cloud Messaging também é um produto sem custo financeiro, porém notificações push automáticas disparadas por lógica confiável normalmente precisam de um backend emissor; se esse backend for implementado com Cloud Functions, então essa automação dependerá do Blaze.

## Regra de segurança do modo demonstração

O fallback local não é usado como substituto de produção:

- é automático somente em GitHub Pages, localhost/127.0.0.1;
- pode ser habilitado explicitamente com `?demo=1`;
- pedidos locais expiram após 24 horas;
- não grava pedido simulado na coleção real `orders`;
- não abre permissões extras nas Firestore Rules;
- não persiste CPF bruto no fallback local;
- erros reais de negócio retornados pelo backend não são convertidos em demonstração.

Após o Blaze e o deploy das Functions, o fluxo real volta a ser a única fonte autoritativa no ambiente de produção.
