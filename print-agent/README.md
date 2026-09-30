# Delivery Pizzaria Print Agent

Aplicativo local para Windows que permite à Central Delivery imprimir comandas diretamente nas impressoras instaladas no computador.

## Versão atual

`1.5.0`

## Como funciona

- Executa na bandeja do Windows.
- Mantém apenas uma instância por usuário do Windows.
- Escuta somente no computador local em `http://127.0.0.1:17329`.
- Lista as impressoras conhecidas pelo Windows.
- A impressora física é escolhida e persistida no próprio Agent.
- Se a impressora salva deixar de existir, tenta usar a impressora padrão do Windows e depois a primeira disponível.
- Recebe da Central Delivery o conteúdo da comanda, o modelo de papel e a logo.
- Imprime silenciosamente pela fila de impressão do Windows.
- Não armazena credenciais do Firebase.
- Não abre portas para outros computadores da rede.

## Inicialização com o Windows

A instalação é feita em:

`%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent`

O Print Agent usa o registro do usuário atual (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) e não precisa executar como administrador para iniciar com o Windows.

O instalador 1.5.0 remove do executável instalado o **Mark-of-the-Web / Zone.Identifier** herdado do ZIP baixado. O próprio Agent também tenta remover essa marca após a primeira execução autorizada. Isso evita que o aviso **“O fornecedor não pôde ser verificado”** seja mostrado novamente a cada login.

> O executável continua sem assinatura Authenticode. Por isso o Windows ainda pode exibir um aviso na primeira execução do arquivo recém-baixado. Eliminar também o primeiro aviso exige assinatura digital de código.

## Controles do Agent

Pelo ícone ao lado do relógio ou pela janela de configurações é possível:

- escolher a impressora física;
- atualizar a lista de impressoras;
- abrir **Impressoras do Windows**;
- imprimir uma página de teste;
- ativar/desativar **Iniciar com o Windows**;
- abrir a Central Delivery;
- fechar apenas a janela mantendo o Agent ativo;
- **Sair do Print Agent**, encerrando realmente o serviço local;
- **Desinstalar Print Agent**, removendo startup, preferências e arquivos instalados.

A ação **Sair do Print Agent** é diferente de fechar a janela: fechar a janela apenas a oculta na bandeja.

## Modelos de impressão

O Agent aplica configurações próprias de papel, margem e fonte para:

- térmica 80 mm;
- térmica 58 mm;
- A4;
- compacto;
- etiqueta 80 × 100 mm.

A logo da pizzaria é impressa nos modelos compatíveis. Alguns drivers térmicos podem impor o tamanho configurado nas Preferências da Impressora; nesse caso o Agent preserva o driver em vez de cancelar a impressão.

## Instalação

1. Baixe o pacote Windows da release estável.
2. Extraia o ZIP.
3. Execute `Instalar.cmd`.
4. Se o Windows pedir confirmação para o arquivo recém-baixado, confirme a primeira execução.
5. O instalador copia e desbloqueia o EXE em AppData antes de iniciar o Agent.
6. Abra as configurações pelo ícone ao lado do relógio.
7. Escolha a impressora física.
8. Use **Imprimir teste**.
9. Na Central Delivery, escolha o modelo de impressão e ative a impressão automática se desejar.

## Desinstalação

Há duas formas:

- no próprio Print Agent, escolha **Desinstalar Print Agent**;
- ou execute `Desinstalar.cmd` do pacote baixado.

Nenhuma das duas exige remoção manual da chave de inicialização do Windows.

## Compatibilidade

A impressão usa a fila e o driver instalados no Windows. Impressoras térmicas, impressoras A4 e modelos de etiqueta que aparecem normalmente em **Configurações → Impressoras e scanners** podem ser utilizados.

Para impressoras térmicas com driver que não aceite papel customizado pelo aplicativo, configure também a largura correspondente nas preferências do driver do Windows.
