# Delivery Pizzaria

Sistema de delivery para pizzaria com cardápio público e painel administrativo separado.

## Recursos

- Cardápio responsivo por categorias.
- Produtos com preço simples ou tamanhos, adicionais, destaque e disponibilidade.
- Carrinho e checkout para entrega ou retirada.
- Seleção de forma de pagamento sem pagamento online, incluindo troco.
- Horários de funcionamento configuráveis e modo forçar aberto/fechado.
- Pedidos numerados em ordem de recebimento.
- Painel administrativo em tempo real.
- Fluxo de status: Novo, Em preparo, Pronto, Saiu para entrega, Concluído e Cancelado.
- Cadastro, edição e exclusão de categorias e produtos.
- Histórico/filtros de pedidos.
- Comanda térmica de 80 mm com todos os dados do pedido.
- Impressão manual e impressão automática preparada para Chrome/Edge com `--kiosk-printing`.
- Fotos de produtos mantidas no próprio repositório (`assets/products/`).
- Firebase Firestore + Authentication.
- Deploy automático no GitHub Pages via GitHub Actions.

## Firebase: configuração inicial obrigatória

O front-end já está ligado ao projeto `delivery-pizzaria-f5b08`.

No Firebase Console:

1. Crie o banco **Cloud Firestore** em modo de produção.
2. Em **Authentication > Sign-in method**, habilite **E-mail/Senha**.
3. Em **Authentication > Users**, crie o usuário administrativo da pizzaria.
4. Publique as regras do arquivo `firestore.rules` (ou execute `firebase deploy --only firestore`).

Não existe cadastro público de administrador. Portanto, somente contas criadas no Firebase Authentication conseguem entrar no painel.

## Primeiro uso

1. Entre em `/admin/`.
2. Abra **Configurações** e cadastre nome, horários, taxa, pagamentos etc.
3. Em **Produtos**, use **Criar cardápio de exemplo** para popular rapidamente pizzas e bebidas, ou crie tudo manualmente.
4. Substitua `assets/products/placeholder.svg` pelas fotos reais e informe o caminho da imagem no produto.

### Imagens no GitHub

Coloque as imagens em:

```text
assets/products/
```

Exemplo:

```text
assets/products/pizza-calabresa.webp
```

No editor do produto informe exatamente esse caminho. Recomenda-se WebP/JPEG otimizados.

## Impressão automática

Navegadores normais exibem a janela de impressão por segurança. Para operação no balcão com impressão automática:

1. Defina a impressora térmica desejada como impressora padrão do Windows.
2. Use o arquivo `abrir-admin-impressao.bat` para abrir o painel no Edge/Chrome com `--kiosk-printing`.
3. No painel, em **Configurações > Impressão**, marque **Imprimir automaticamente novos pedidos**.
4. Mantenha o painel aberto durante o expediente.

A impressão manual continua disponível dentro de cada pedido.

## GitHub Pages

O workflow `.github/workflows/pages.yml` publica a branch `main`. Se necessário, em **Settings > Pages**, selecione GitHub Actions como fonte de publicação.

URL esperada:

- Público: `https://guiasysstudio.github.io/Delivery-Pizzaria/`
- Admin: `https://guiasysstudio.github.io/Delivery-Pizzaria/admin/`

## Segurança

A configuração Web do Firebase é pública por natureza. A proteção dos dados fica nas regras do Firestore e no Firebase Authentication. O público pode ler cardápio/configurações e criar pedidos; somente usuários autenticados podem ler pedidos e alterar dados administrativos.
