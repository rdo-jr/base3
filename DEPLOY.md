# Deploy online

Este projeto agora pode ser publicado em uma plataforma que suporte Node.js e PostgreSQL.

## O que a aplicação espera

- `DATABASE_URL` apontando para um PostgreSQL gerenciado
- `ADMIN_PASSWORD` definido na primeira publicação
- `NODE_ENV=production`

## Caminho mais simples

### Render

1. Suba este projeto para um repositório Git.
2. Crie um novo Web Service usando o repositório.
3. A plataforma vai usar o `Dockerfile` deste projeto.
4. Crie um PostgreSQL gerenciado na mesma conta.
5. Aponte `DATABASE_URL` para o banco criado.
6. Defina `ADMIN_PASSWORD` como segredo.
7. Publique e abra o link gerado pela plataforma.

### Railway

1. Suba este projeto para um repositório Git.
2. Crie um projeto novo.
3. Adicione um serviço PostgreSQL.
4. Adicione um serviço para o app Node.
5. Passe `DATABASE_URL` e `ADMIN_PASSWORD` para o serviço do app.
6. Publique e use a URL pública gerada.

## Modo local

Se você rodar sem `DATABASE_URL`, o projeto continua usando o PostgreSQL local da máquina para desenvolvimento.
