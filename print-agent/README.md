# Delivery Pizzaria Print Agent

Aplicativo local para Windows que permite ao painel administrativo imprimir comandas diretamente em qualquer impressora instalada no Windows.

## Como funciona

- Executa na bandeja do Windows.
- Escuta somente no computador local em \`http://127.0.0.1:17329\`.
- Lista as impressoras que o Windows conhece.
- Recebe a comanda do painel administrativo.
- Imprime de forma silenciosa pela fila de impressão do Windows.
- Não armazena credenciais do Firebase.
- Não abre portas para outros computadores da rede.

## Uso

1. Baixe o artefato Windows gerado pelo workflow **Build Print Agent**.
2. Abra \`DeliveryPizzaria.PrintAgent.exe\`.
3. No ícone da bandeja, marque **Iniciar com o Windows** se desejar.
4. Abra ADM > Impressão.
5. Clique **Procurar impressoras**.
6. Selecione a impressora instalada no Windows.
7. Use **Imprimir teste**.
8. Ative a impressão automática nesta estação.

## Compatibilidade

A impressão utiliza o driver instalado no Windows. Portanto, impressoras térmicas/cupom, A4 e outras impressoras que aparecem normalmente em Configurações > Impressoras e scanners podem ser selecionadas.

Para impressoras térmicas, configure o tamanho de papel correto (por exemplo, 80 mm) nas preferências do driver do Windows.
