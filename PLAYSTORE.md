# Publicação na Play Store

Este projeto já está preparado para Android e agora também para gerar um pacote de publicação (`AAB`) assinado.

## O que já foi configurado

- `android/app/build.gradle` aceita um `keystore` de release
- arquivos sensíveis de assinatura foram colocados fora do Git
- o app usa o backend online em `https://base3.onrender.com`

## O que ainda depende da sua conta Google

- criar ou acessar uma conta de desenvolvedor no Play Console
- pagar a taxa de cadastro
- aceitar o contrato do desenvolvedor
- criar o app dentro do Play Console
- enviar o arquivo `.aab`

## Onde ficam os arquivos de assinatura

Coloque estes arquivos dentro da pasta `android/`:

- `android/keystore.properties`
- `android/upload-keystore.jks`

O arquivo `keystore.properties` deve conter:

```properties
storeFile=upload-keystore.jks
storePassword=SUA_SENHA
keyAlias=SEU_ALIAS
keyPassword=SUA_SENHA
```

## Como gerar o AAB

```powershell
cd android
.\gradlew.bat bundleRelease
```

O arquivo final fica em:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

## Passo a passo no Play Console

1. Entre no [Play Console](https://play.google.com/console).
2. Crie um novo app.
3. Preencha nome, idioma e tipo do app.
4. Vá em `Release > Production` ou primeiro em `Testing > Internal testing`.
5. Envie o arquivo `app-release.aab`.
6. Preencha a ficha do app, política de privacidade e classificação de conteúdo.
7. Envie para revisão.

## Observação importante

Para publicar de verdade na Play Store, o ideal é usar um pacote assinado de release e seguir os requisitos do Google Play App Signing.
