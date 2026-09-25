# Documentação de API para frontend e integração SSE

## 1. Objetivo

Este documento define o contrato de integração entre o portal principal e o backend do BuscaCCT. O objetivo é permitir que a equipe do frontend embarque o componente React do Copiloto e a Action Inbox sem depender de suposições sobre os endpoints, payloads ou eventos em tempo real.

---

## 2. Base URL

### Produção

```text
https://api.exemplo.com
```

### Homologação

```text
https://api-homolog.exemplo.com
```

O projeto aceita também os endpoints com prefixo legado `/modulo-dp`, mas o padrão recomendado para integração com o portal é usar `/api/modulo-dp`.

---

## 3. Endpoints

### 3.1 Healthcheck

#### GET /health

Retorna o status do serviço.

Resposta esperada:

```json
{
  "status": "ok",
  "timestamp": "2026-09-24T12:00:00.000Z"
}
```

---

### 3.2 Consultar buscador

#### POST /api/modulo-dp/consultar

Consulta o buscador usando o fluxo do Claude + tools.

Request body:

```json
{
  "pergunta": "Verifique se saiu a CCT 2026 do Sindicato do Comércio. CNPJ laboral 12345678000195."
}
```

Resposta esperada:

```json
{
  "resposta": "A Convenção Coletiva foi identificada ...",
  "fonte": "Sistema Mediador / IBGE / Cache local",
  "contexto": {
    "cnpjSindicatoLaboral": "12345678000195",
    "periodo": "2026",
    "status": "OK"
  },
  "observacoes": [
    "Dados obtidos por ferramenta oficial e validados pelo backend."
  ]
}
```

Observações:
- a pergunta deve ser textual e objetiva
- o backend decide se usa cache, MTE ou IBGE
- o frontend não precisa saber qual tool foi usada

---

### 3.3 Listar alertas resumidos

#### GET /api/modulo-dp/alertas/sindicatos

Retorna os alertas mais relevantes para a Action Inbox do portal.

Resposta esperada:

```json
[
  {
    "id": 101,
    "cnpjSindicato": "12345678000195",
    "titulo": "Nova CCT identificada",
    "prioridade": "alta",
    "status": "ABERTO",
    "dataCriacao": "2026-09-24T09:00:00.000Z"
  }
]
```

---

### 3.4 Listar alertas completos

#### GET /api/modulo-dp/alertas

Retorna o conjunto completo de alertas.

Resposta esperada:

```json
[
  {
    "id": 101,
    "cnpjSindicato": "12345678000195",
    "tipo": "NOVA_CCT",
    "titulo": "Nova convenção coletivada identificada",
    "mensagem": "Foi localizada uma atualização relevante para o sindicato.",
    "status": "ABERTO",
    "prioridade": "alta",
    "dataCriacao": "2026-09-24T09:00:00.000Z"
  }
]
```

---

### 3.5 Obter parâmetros da CCT

#### GET /api/modulo-dp/parametros-cct/:cnpj

Retorna os parâmetros estruturados da CCT mais recente do sindicato informado.

Exemplo:

```text
GET /api/modulo-dp/parametros-cct/12345678000195
```

Resposta esperada:

```json
{
  "cnpjSindicato": "12345678000195",
  "anoVigencia": 2025,
  "fonteUrl": "https://mediador.trabalho.gov.br/sistemas/mediador/ConsultarInstColetivo",
  "pisos_salariais": [
    {
      "cargo_ou_categoria": "Geral",
      "valor": 1950.0
    }
  ],
  "horas_extras": [
    {
      "condicao": "Domingos e feriados",
      "percentual": 100
    }
  ],
  "beneficios": {
    "vale_refeicao_diario": null,
    "desconto_vale_refeicao_percentual": null,
    "quebra_de_caixa_mensal": null,
    "anuenio_percentual": null
  },
  "resumo_mudancas": "Piso geral identificado no documento."
}
```

Observações:
- este endpoint é a fonte principal para o Copiloto do portal
- o frontend deve usar os campos retornados diretamente para montar a tela de parametrização
- valores ausentes devem ser tratados como `null`

---

### 3.6 Stream de alertas em tempo real

#### GET /api/modulo-dp/alertas/stream

Abre um fluxo SSE para o portal receber notificações em tempo real.

Exemplo de consumo no frontend:

```javascript
const eventSource = new EventSource('/api/modulo-dp/alertas/stream');

eventSource.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  console.log('Novo alerta:', payload);
};

eventSource.onerror = () => {
  console.error('Erro no SSE');
};
```

Formato de evento esperado:

```json
{
  "id": 101,
  "tipo": "NOVA_CCT",
  "cnpjSindicato": "12345678000195",
  "titulo": "Nova convenção identificada",
  "mensagem": "Foi localizada uma atualização relevante.",
  "prioridade": "alta",
  "status": "ABERTO",
  "timestamp": "2026-09-24T09:00:00.000Z"
}
```

Compatibilidade:
- a rota legado `/modulo-dp/alertas/stream` também deve continuar funcionando
- o frontend pode usar o caminho novo e preferencial

---

### 3.7 Concluir alerta

#### PATCH /api/modulo-dp/alertas/:id/concluir

Marca um alerta como concluído após o uso do sistema pelo analista.

Request body:

```json
{
  "status": "RESOLVIDO",
  "observacao": "Parâmetros atualizados no ERP interno."
}
```

Resposta esperada:

```json
{
  "id": 101,
  "status": "RESOLVIDO",
  "ok": true
}
```

---

## 4. Fluxo recomendado para o frontend

### 4.1 Carregar alertas na inicialização

Ao entrar na tela do módulo DP:

```javascript
async function carregarAlertas() {
  const response = await fetch('/api/modulo-dp/alertas');
  const alertas = await response.json();
  return alertas;
}
```

### 4.2 Abrir o Copiloto ao clicar em um alerta

Ao clicar em um alerta, o portal deve abrir o detalhe do sindicato e buscar os parâmetros da CCT:

```javascript
async function carregarParametros(cnpj) {
  const response = await fetch(`/api/modulo-dp/parametros-cct/${cnpj}`);
  return response.json();
}
```

### 4.3 Atualização em tempo real

```javascript
const stream = new EventSource('/api/modulo-dp/alertas/stream');

stream.addEventListener('message', (event) => {
  const alerta = JSON.parse(event.data);
  adicionarAlertaNaInbox(alerta);
});
```

### 4.4 Conclusão da ação

```javascript
async function concluirAlerta(id) {
  await fetch(`/api/modulo-dp/alertas/${id}/concluir`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'RESOLVIDO',
      observacao: 'Parâmetros ajustados.'
    })
  });
}
```

---

## 5. Melhor prática para UX

- manter a inbox atualizada em tempo real via SSE
- exibir prioridade visual (`alta`, `media`, `baixa`)
- mostrar o `cnpjSindicato` em cada alerta para facilitar o contexto
- renderizar os parâmetros em formato legível para cópia e atualização no ERP
- manter a conclusão do alerta após a validação humana

---

## 6. Tratamento de erros

### Erro 400

Uso incorreto de payload ou parâmetro inválido.

### Erro 401/403

Autenticação ou autorização ausente.

### Erro 404

Recurso não encontrado, como CNPJ inexistente ou alerta inexistente.

### Erro 500

Falha interna do backend, geralmente com serviço externo ou extração do Claude.

No frontend, o ideal é tratar os erros com fallback amigável e mensagem clara para o usuário.

---

## 7. Regras de integração

- usar o prefixo `/api/modulo-dp` em novos integrações
- manter fallback compatível para o caminho legado
- tratar `null` em campos opcionais sem quebrar a renderização
- não exigir que o frontend saiba se a fonte foi MTE, IBGE ou cache
- usar SSE para atualização ativa e fetch para leitura inicial

---

## 8. Resumo executivo

O portal principal deve:
1. carregar alertas na tela inicial;
2. consultar os parâmetros da CCT por CNPJ ao abrir o detalhe;
3. receber atualizações em tempo real via SSE;
4. concluir o alerta após a ação do analista.

Esse fluxo cria uma Action Inbox funcional e reduz o retrabalho do departamento pessoal.
