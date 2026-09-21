# Cachômetro — próxima etapa (VPS e dados)

Este arquivo registra as decisões de produto e o que será necessário para conectar o aplicativo a um servidor real.

## Decisões já tomadas

- Aplicativo privado para exatamente duas pessoas.
- Abre diretamente na câmera depois do primeiro acesso.
- Mensagem de texto opcional e livre, com até 240 caracteres no protótipo.
- A notificação não exibe o texto da mensagem.
- A pessoa que enviou vê quando a foto foi aberta.
- É possível reagir com um emoji.
- A foto desaparece do feed 24 horas depois do envio.
- É possível salvar a foto original na galeria do aparelho.
- A apresentação pode usar coração, estrela, círculo, quadrado arredondado ou quadrado.

## Regra das 24 horas

Cada publicação terá `created_at` e `expires_at`. O servidor define `expires_at = created_at + 24 horas`; não se deve confiar no relógio do celular. Após a expiração:

1. a API deixa de retornar a publicação imediatamente;
2. uma rotina periódica apaga o arquivo do armazenamento;
3. os metadados podem ser removidos ou anonimizados depois de um pequeno período operacional.

Salvar na galeria cria uma cópia fora do aplicativo. Essa cópia não pode ser apagada pelo servidor após 24 horas, e isso deve ser explicado de forma clara para os dois usuários.

## Arquitetura proposta

- App: Expo, React Native e TypeScript.
- API: Node.js + Fastify, executada em contêiner Docker.
- Banco: PostgreSQL.
- Fotos: armazenamento compatível com S3. Pode ser Cloudflare R2 ou MinIO na VPS.
- HTTPS e proxy: Caddy ou Nginx.
- Push: Expo Push Service no MVP.
- Limpeza: job executado a cada poucos minutos para excluir fotos expiradas.

As fotos não devem ser armazenadas como bytes dentro do PostgreSQL. O banco guarda a chave do objeto e os metadados. O bucket deve ser privado, com URLs temporárias assinadas.

## Estrutura inicial do banco

### users

- `id` UUID, chave primária
- `name` texto
- `email` texto, único
- `password_hash` texto
- `created_at` timestamp

### couples e couple_members

- casal com UUID e código de convite armazenado como hash
- membros ligados por `couple_id` e `user_id`
- restrição de no máximo dois membros por casal

### posts

- `id`, `couple_id` e `sender_id` (UUID)
- `image_key` texto
- `message` texto opcional
- `shape`: `heart`, `star`, `circle`, `soft_square` ou `square`
- `created_at`, `expires_at` e `opened_at`

### reactions

- `id`, `post_id`, `user_id`, `emoji` e `created_at`
- uma reação por usuário/publicação no MVP

### devices

- `id`, `user_id`, `expo_push_token`, `platform`, `active` e `updated_at`

## Fluxo de envio

1. O app solicita à API uma URL temporária para upload.
2. O app envia a imagem comprimida diretamente ao armazenamento.
3. O app confirma o envio e passa mensagem, máscara e chave da imagem à API.
4. A API cria a publicação, calcula a expiração e envia uma notificação ao outro aparelho.
5. A notificação contém apenas um título genérico e `postId` nos dados internos.
6. Ao abrir a publicação, o app chama um endpoint de leitura; a API preenche `opened_at`.

## Informações necessárias da VPS

Não colocar senhas ou chaves neste arquivo nem enviá-las em texto público. Quando a integração começar, fornecer:

- endereço IP ou hostname da VPS;
- distribuição e versão do sistema operacional;
- usuário SSH de implantação com `sudo`, preferencialmente temporário;
- chave SSH, em vez de senha;
- domínio ou subdomínio que apontará para a API, por exemplo `api.exemplo.com`;
- informação sobre Docker e Docker Compose já estarem instalados;
- portas e firewall atualmente configurados;
- memória, CPU e espaço livre da VPS;
- provedor de DNS;
- política ou destino desejado para backups.

Também será preciso decidir entre Cloudflare R2/outro serviço S3 (recomendado) ou MinIO na própria VPS (mais autocontido, mas dependente de backup externo).

## Contas e credenciais futuras

- Conta Expo e projeto EAS.
- Conta Apple Developer para build/distribuição e credenciais de push.
- Credenciais do armazenamento S3/MinIO com acesso restrito ao bucket.
- Segredos da API gerados no servidor (`JWT_SECRET`, credenciais do PostgreSQL etc.).

## Segurança mínima

- HTTPS obrigatório; senhas com Argon2id; tokens curtos e refresh token rotativo.
- Bucket privado e URLs assinadas de curta duração.
- Todo acesso validado pelo mesmo `couple_id`.
- Limite de tamanho e validação do tipo real do arquivo.
- Remoção de tokens push inválidos.
- Backups criptografados do PostgreSQL; imagens expiradas não entram em backups permanentes.
- Logs nunca contêm mensagens, fotos, senhas ou tokens completos.

## Próximas entregas sugeridas

1. Subir PostgreSQL, API e armazenamento.
2. Implementar login e pareamento por convite único.
3. Conectar upload e feed com expiração.
4. Implementar recibo de abertura e reações.
5. Configurar notificações e deep link até a foto.
6. Gerar development build no iPhone e validar via TestFlight.
