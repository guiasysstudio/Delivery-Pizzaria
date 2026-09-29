# Delivery Pizzaria Print Agent

Aplicativo local para Windows que permite ao painel administrativo imprimir comandas diretamente nas impressoras instaladas no computador.

## Versão atual

`1.4.0`

## Como funciona

- Executa na bandeja do Windows.
- Mantém apenas uma instância por usuário do Windows.
- Escuta somente no computador local em `http://127.0.0.1:17329`.
- Lista as impressoras conhecidas pelo Windows.
- A impressora física é escolhida e persistida no próprio Agent.
- Se a impressora salva deixar de existir, tenta usar a impressora padrão do Windows e depois a primeira disponível.
- Recebe a comanda, o modelo de papel e a logo vindos da Central Delivery.
- Imprime silenciosamente pela fila de impressão do Windows.
- Não armazena credenciais do Firebase.
- Não abre portas para outros computadores da rede.

## Modelos de impressão

O Agent aplica configurações próprias de papel, margem e fonte para:

- térmica 80 mm;
- térmica 58 mm;
- A4;
- compacto;
- etiqueta 80 × 100 mm.

A logo da pizzaria é impressa nos modelos compatíveis. Alguns drivers térmicos podem impor o tamanho configurado nas Preferências da Impressora; nesse caso o Agent preserva o driver em vez de cancelar a impressão.

## Uso

1. Baixe o pacote Windows da release estável.
2. Execute `Instalar.cmd`.
3. Abra as configurações pelo ícone ao lado do relógio.
4. Escolha a impressora física.
5. Abra **Central Delivery → Impressão**.
6. Escolha o modelo de impressão.
7. Use **Imprimir teste**.
8. Ative a impressão automática se desejar.

## Compatibilidade

A impressão usa a fila e o driver instalados no Windows. Impressoras térmicas, impressoras A4 e modelos de etiqueta que aparecem normalmente em **Configurações → Impressoras e scanners** podem ser utilizados.

Para impressoras térmicas com driver que não aceite papel customizado pelo aplicativo, configure também a largura correspondente nas preferências do driver do Windows.
