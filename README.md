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
- fechamento com dinheiro contado;
- valor esperado;
- diferença de caixa;
- observação e histórico.

A abertura usa transação para evitar dois caixas abertos simultaneamente por computadores diferentes.

## Perfis e permissões

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

Recursos:

- detecta impressoras instaladas no Windows;
- imprime diretamente pela fila do Windows;
- seleção de impressora por estação;
- impressão de teste;
- impressão automática;
- janela de configuração ao clicar no ícone da bandeja;
- iniciar com o Windows;
- início automático habilitado no primeiro uso;
- identidade visual própria;
- instalador/desinstalador por usuário.

Pacote estável:

```text
https://github.com/guiasysstudio/Delivery-Pizzaria/releases/download/print-agent-latest/DeliveryPizzaria-PrintAgent-win-x64.zip
```

Use `Instalar.cmd` dentro do pacote para instalar em `%LOCALAPPDATA%\DeliveryPizzaria\PrintAgent`.

## Firebase

Projeto:

```text
delivery-pizzaria-f5b08
```

### Authentication

Habilitar:

- E-mail/Senha.
- Google.

Adicionar `guiasysstudio.github.io` aos domínios autorizados do Firebase Authentication.

### Firestore

As regras oficiais estão em:

```text
firestore.rules
```

As regras devem ser publicadas sempre que esse arquivo mudar.

### Firebase Functions

A pasta `functions/` contém:

- `uploadProductImage`: envia WebP autenticado ao GitHub.
- `grantLoyaltyCoupons`: entrega automaticamente recompensas de fidelidade após pedidos concluídos.

Para o upload de imagem, configurar o secret:

```text
DELIVERY_GITHUB_TOKEN
```

Esse token deve ser fine-grained, restrito ao repositório Delivery-Pizzaria e com permissão de Contents: Read and write.

Depois, publicar as Functions com Firebase CLI.

> Cloud Functions em produção pode exigir o plano Blaze do Firebase.

## Validação automática

O workflow **Validate Delivery Pizzaria** verifica:

- sintaxe JavaScript do site, conta, Central Delivery, service worker e Functions;
- seletores com risco de erro `$().forEach`;
- referências de IDs entre JavaScript e HTML;
- IDs HTML duplicados;
- manifesto PWA;
- arquivos obrigatórios.

O workflow **Build Print Agent** compila o Windows x64 e atualiza o pacote estável.

O GitHub Pages publica automaticamente a branch `main`.
