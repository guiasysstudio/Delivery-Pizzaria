# Delivery Pizzaria Print Agent

Aplicativo local para Windows que permite à Central Delivery imprimir comandas diretamente nas impressoras instaladas no computador.

## Versão atual

`1.8.0`

## Como funciona

- Executa na bandeja do Windows.
- Mantém apenas uma instância por usuário.
- Escuta somente em `http://127.0.0.1:17329`.
- Lista as impressoras instaladas no Windows.
- Salva a impressora selecionada no próprio Agent.
- Imprime silenciosamente pela fila de impressão do Windows.
- Não armazena credenciais do Firebase.
- Não abre a porta de impressão para outros computadores da rede.

## Instalação 1.8

A distribuição normal não usa mais `.bat` ou `.cmd`.

O usuário baixa apenas:

`DeliveryPizzaria-PrintAgent-Setup-x64.exe`

O instalador:

- instala o Agent como um programa do Windows;
- cria atalho na Área de Trabalho;
- cria atalho no Menu Iniciar;
- registra o desinstalador em **Aplicativos instalados**;
- configura a inicialização automática com o Windows;
- remove a instalação legada 1.7 em `%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent`;
- preserva a impressora já escolhida durante a atualização;
- inicia o Agent ao terminar.

O instalador não exige arquivos DLL ou PDB separados: o Agent é publicado como EXE self-contained/single-file.

### Pasta de instalação

Na primeira instalação, se existir `D:\Programas`, o instalador sugere:

`D:\Programas\GuiaSys\Delivery Pizzaria Print Agent`

Caso contrário, usa:

`%LOCALAPPDATA%\Programs\GuiaSys\Delivery Pizzaria Print Agent`

A tela do instalador permite alterar a pasta. Atualizações posteriores preservam o local escolhido.

## Reabrir o Agent

O atalho da Área de Trabalho e o atalho do Menu Iniciar executam o Agent em modo de abertura da janela.

Comportamento esperado:

- se o Agent estiver totalmente fechado, o atalho inicia o serviço e abre as configurações;
- se o Agent já estiver ativo apenas na bandeja, o atalho reutiliza a mesma instância e traz a janela de configurações para frente;
- a inicialização automática do Windows usa `--background`, portanto não abre a janela a cada login.

## Controles do Agent

Pelo ícone ao lado do relógio ou pela janela de configurações é possível:

- escolher a impressora;
- atualizar a lista de impressoras;
- abrir **Impressoras do Windows**;
- imprimir uma página de teste;
- ativar/desativar **Iniciar com o Windows**;
- abrir a Central Delivery;
- fechar apenas a janela e manter o Agent na bandeja;
- **Sair do Print Agent**, encerrando o processo;
- **Desinstalar Print Agent**, chamando o desinstalador EXE do próprio instalador.

## Desinstalação

Pode ser feita de três maneiras:

1. no próprio Agent: **Desinstalar Print Agent**;
2. Menu Iniciar → **Desinstalar Delivery Pizzaria Print Agent**;
3. Windows → **Configurações → Aplicativos instalados**.

A desinstalação remove Agent, atalhos, inicialização automática e preferências locais.

## Atualização a partir da 1.7

A versão 1.8 encerra a versão antiga durante a instalação e remove a antiga pasta em AppData. Os antigos arquivos `Instalar.cmd` e `Desinstalar.cmd` não fazem parte do novo pacote.

O código do Agent mantém somente uma compatibilidade de desinstalação para instalações legadas que ainda estejam executando a 1.7.

## Segurança

O Agent aceita requisições de impressão apenas das origens autorizadas e limita corpo HTTP, texto, cópias e modelos aceitos. Se a porta `17329` não puder ser aberta, informa a falha e encerra.

O executável ainda pode exibir SmartScreen/fornecedor desconhecido enquanto não houver assinatura Authenticode. O instalador tenta remover Mark-of-the-Web do EXE instalado, mas isso não substitui uma assinatura digital de código.

## Modelos de impressão

- térmica 80 mm;
- térmica 58 mm;
- A4;
- compacto;
- etiqueta 80 × 100 mm.

Alguns drivers térmicos podem impor o tamanho configurado nas Preferências da Impressora. Nesse caso, ajuste também a largura no driver do Windows.
