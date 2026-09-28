# Delivery Pizzaria

Sistema completo de delivery para pizzaria, com site público, conta do cliente, múltiplos endereços, checkout sem pagamento online, painel administrativo em tempo real e impressão automática por impressora instalada no Windows.

## URLs

- Público: \`https://guiasysstudio.github.io/Delivery-Pizzaria/\`
- Minha Conta: \`https://guiasysstudio.github.io/Delivery-Pizzaria/account/\`
- Administrativo: \`https://guiasysstudio.github.io/Delivery-Pizzaria/admin/\`

## Site público

- Cardápio por categorias.
- Produtos simples, bebidas e pizzas.
- Tamanhos e preços por tamanho.
- Pizza meio a meio.
- Adicionais/bordas.
- Observação por item.
- Favoritos.
- Carrinho persistente.
- Entrega ou retirada.
- Horário de funcionamento automático.
- Pedido mínimo e taxa de entrega configuráveis.
- Taxas por bairro e opção de restringir a área de entrega.
- Cadastro/login do cliente por:
  - Google.
  - E-mail e senha.
- Minha Conta:
  - dados pessoais;
  - troca de usuário;
  - logout;
  - vários endereços;
  - endereço principal;
  - CEP com preenchimento automático;
  - histórico de pedidos;
  - pedir novamente;
  - favoritos.
- Endereço ativo exibido no topo do cardápio.
- Troca de endereço no checkout.
- Aplicável como PWA na tela inicial do celular.

## Pagamento

Não existe pagamento online.

O cliente apenas informa como irá pagar:

- Dinheiro.
- PIX na entrega/retirada.
- Cartão de débito.
- Cartão de crédito.
- Outras formas que o administrador cadastrar.

Quando o pagamento é em dinheiro:

- o cliente escolhe se precisa de troco;
- informa o valor entregue;
- o sistema calcula o valor do troco;
- a comanda mostra “Troco para” e “Levar de troco”.

## Painel administrativo

Perfis disponíveis:

- **Master** — acesso total.
- **Gerente** — operação, cardápio, clientes, configurações e impressão.
- **Caixa** — pedidos, clientes e impressão.
- **Cozinha** — andamento de produção.
- **Entrega** — saída e conclusão da entrega.
- **Operador** — operação dos pedidos.

O Master cria os demais usuários diretamente no painel usando **Usuário + Senha**.

Fluxo do pedido:

1. Aguardando confirmação.
2. Confirmado.
3. Em preparo.
4. Pronto.
5. Saiu para entrega.
6. Concluído.
7. Cancelado.

Em Configurações é possível escolher:

- confirmar pedidos automaticamente; ou
- exigir aceite manual do caixa/gerente.

## Impressão no Windows

A impressão automática é feita pelo **Delivery Pizzaria Print Agent**, localizado no diretório \`print-agent/\`.

Motivo: navegadores comuns não podem selecionar silenciosamente uma impressora instalada no Windows.

O Print Agent:

- roda localmente na bandeja do Windows;
- lista qualquer impressora instalada no Windows;
- recebe a comanda pelo endereço local \`127.0.0.1\`;
- imprime diretamente pela fila de impressão do Windows;
- não armazena credenciais do Firebase;
- não abre serviço para outros computadores da rede;
- pode iniciar junto com o Windows.

### Build do Print Agent

O workflow **Build Print Agent** gera automaticamente o executável Windows x64 e mantém um pacote de download estável em:

```text
https://github.com/guiasysstudio/Delivery-Pizzaria/releases/download/print-agent-latest/DeliveryPizzaria-PrintAgent-win-x64.zip
```

O mesmo pacote continua disponível como artifact do GitHub Actions.

Depois de abrir o Print Agent:

1. Entre no ADM.
2. Abra **Impressão**.
3. Clique **Procurar impressoras**.
4. Selecione a impressora do Windows.
5. Use **Imprimir teste**.
6. Ative a impressão automática nesta estação.

A configuração da impressora é local por computador, evitando que vários caixas imprimam a mesma comanda sem necessidade.

## Fotos dos produtos

As fotos ficam no GitHub:

\`\`\`text
assets/products/
\`\`\`

Exemplo:

\`\`\`text
assets/products/pizza-calabresa.webp
\`\`\`

No editor do produto informe esse caminho.

## Firebase

Projeto atual:

\`\`\`text
delivery-pizzaria-f5b08
\`\`\`

### Authentication

Habilitar:

- E-mail/Senha.
- Google.

Adicionar em **Authentication > Settings > Authorized domains**:

\`\`\`text
guiasysstudio.github.io
\`\`\`

O usuário Master inicial usa internamente:

\`\`\`text
master@delivery-pizzaria.local
\`\`\`

Na tela do ADM aparece apenas:

\`\`\`text
Usuário: master
Senha: ********
\`\`\`

### Firestore

As regras oficiais estão em:

\`\`\`text
firestore.rules
\`\`\`

Após mudanças neste arquivo, publique as regras no Firebase Console ou via Firebase CLI:

\`\`\`bash
firebase deploy --only firestore
\`\`\`

As regras separam:

- dados públicos do cardápio;
- dados privados do cliente;
- endereços e favoritos do próprio cliente;
- histórico de pedidos do próprio cliente;
- permissões administrativas por perfil;
- mapa interno de login da equipe sem conceder permissão apenas pelo e-mail.

## Desenvolvimento e validação

O workflow **Validate Delivery Pizzaria** verifica sintaxe de todos os módulos JavaScript, service worker, manifesto PWA, arquivos obrigatórios e IDs HTML duplicados.

O GitHub Pages publica automaticamente a branch \`main\`.
