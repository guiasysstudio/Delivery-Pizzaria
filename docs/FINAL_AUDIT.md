# Auditoria final — Módulo 6

Esta etapa fecha a estabilização de código antes da publicação real no Firebase de produção.

## Escala aplicada

- Pedidos ativos do ADM permanecem em tempo real.
- O histórico administrativo carrega uma janela recente de 200 pedidos e pagina os anteriores sob demanda.
- A conta do cliente carrega 25 pedidos por página e mantém acompanhamento em tempo real da janela recente.
- A exportação de dados do cliente continua completa e não depende da paginação visual.
- Consultas de elegibilidade de cupons e estatísticas do cliente filtram pedidos concluídos no Firestore.
- Índices compostos explícitos suportam histórico do cliente e consultas por status.
- Consulta de CEP foi centralizada em `assets/cep.js`, com cache temporário e deduplicação de requisições simultâneas.

## Auditoria de segurança e LGPD

- O CPF bruto não é mantido no cadastro operacional.
- Dados privados de pedido permanecem separados em `orderPrivate`.
- A exclusão de conta remove dados de perfil e anonimiza registros transacionais retidos.
- A exportação de dados consulta todo o histórico do cliente, inclusive páginas ainda não abertas na interface.
- O aviso de privacidade descreve retenção, minimização, exportação, exclusão e confirmação de identidade.
- O painel administrativo continua usando resumo anonimizado de clientes.

## Cenários adversos automatizados

A suíte do Módulo 6 cobre guardas para:

- duplo clique/retry idempotente;
- queda de rede com requestId persistente;
- pedidos simultâneos e contador transacional;
- alteração de preço;
- produto indisponível;
- cupom expirado ou inativo;
- endereço/bairro adulterado pelo navegador;
- `NaN`, quantidade fracionada, zero e acima do limite;
- usuário sem permissão;
- tentativa de dois caixas simultâneos;
- Print Agent desconectado com falha visível;
- paginação de histórico e ausência de listeners globais ilimitados;
- deduplicação da consulta de CEP.

## Comando local

```powershell
node scripts/final-audit.mjs
```

## O que ainda depende do ambiente real

A auditoria de código não substitui três validações externas:

1. habilitar Blaze e publicar Functions, Rules, índices e Hosting no projeto Firebase;
2. executar o smoke test contra o domínio Firebase/produção após o deploy;
3. validar uma impressão física em uma impressora real do cliente.

Esses itens não bloqueiam a demonstração em ambiente atual, mas bloqueiam declarar o ambiente Firebase de produção como implantado.
