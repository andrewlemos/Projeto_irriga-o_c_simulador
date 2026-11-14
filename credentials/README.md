# Credenciais Firebase (não versionadas)

1. No [Firebase Console](https://console.firebase.google.com/) → Project settings → Service accounts → Generate new private key.
2. Salve o arquivo baixado como:

```text
credentials/serviceAccount.json
```

3. Ou defina a variável de ambiente:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/caminho/absoluto/para/sua-chave.json"
```

Este diretório está no `.gitignore`. O arquivo `serviceAccount.json` **nunca** deve ser commitado.
