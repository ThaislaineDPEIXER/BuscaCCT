# Importação do ERP para o formato do seed

## 1. Objetivo

Este documento define como a equipe operacional deve exportar clientes e sindicatos do ERP (Domínio/Alterdata) para o formato JSON exigido por `prisma/seed.ts`, preservando a estrutura mínima necessária para o carregamento inicial e para o fluxo de enquadramento sindical.

---

## 2. Regras gerais

### 2.1 Formato obrigatório

Os arquivos devem ser JSON em array, com objetos no formato exato abaixo.

### 2.2 Normalização obrigatória

Antes de importar:
- remover pontuação do CNPJ
- manter apenas números
- validar que o CNPJ tenha 14 dígitos
- padronizar UF em maiúsculas
- padronizar cidade e empresa em texto sem caracteres acidentalmente duplicados
- remover registros duplicados por CNPJ

### 2.3 Regras de negócio para o seed

- `sindicatos.json` deve incluir sindicatos ativos e relevantes para o território
- `clientes.json` deve incluir clientes com CNAE principal e localização
- o seed cria sugestões de vínculo com base em UF + cidade, quando houver coincidência
- se houver mais de um sindicato na mesma cidade, o sistema usa a ordem definida pelo seed e pela regra interna de priorização

---

## 3. Estrutura do arquivo `sindicatos.json`

### Campos obrigatórios

```json
[
  {
    "cnpj": "12345678000195",
    "razaoSocial": "Sindicato dos Trabalhadores da Indústria do Comércio",
    "nomeFantasia": "STIC",
    "uf": "SP",
    "cidade": "São Paulo",
    "segmento": "Comércio",
    "cnae": "9420-1/00"
  }
]
```

### Descrição dos campos

- `cnpj`: CNPJ do sindicato, sem máscara
- `razaoSocial`: razão social oficial
- `nomeFantasia`: nome fantasia, quando existir
- `uf`: UF do sindicato
- `cidade`: município do sindicato
- `segmento`: segmento do sindicato, se houver no ERP
- `cnae`: CNAE principal ou setor representativo; se não houver, usar `9420-1/00` como valor padrão

### Regras

- o CNPJ deve ser único
- o campo `cnae` deve seguir o mesmo padrão da base de dados do projeto, com foco em normas nacionais
- se o sindicato estiver inativo, não incluir ou marcá-lo como inativo no processamento posterior

---

## 4. Estrutura do arquivo `clientes.json`

### Campos obrigatórios

```json
[
  {
    "cnpj": "11222333000144",
    "razaoSocial": "Empresa Exemplo Ltda",
    "cnaePrincipal": "4721101",
    "descricaoCnae": "Comércio varejista de mercadorias em geral",
    "uf": "SP",
    "cidade": "Campinas"
  }
]
```

### Descrição dos campos

- `cnpj`: CNPJ do cliente, sem máscara
- `razaoSocial`: razão social da empresa
- `cnaePrincipal`: CNAE principal do cliente
- `descricaoCnae`: descrição textual do CNAE
- `uf`: UF da sede da empresa
- `cidade`: município da sede da empresa

### Regras

- o CNPJ deve ser único
- se a empresa tiver múltiplas matrizes, manter apenas a matriz principal para o seed
- se houver filiais sem vínculo sindical claro, o ideal é não incluir no carregamento inicial

---

## 5. Exportação no ERP

### 5.1 Domínio / Alterdata

A exportação deve seguir este padrão:

#### Para sindicatos
- campo 1: `cnpj`
- campo 2: `razaoSocial`
- campo 3: `nomeFantasia`
- campo 4: `uf`
- campo 5: `cidade`
- campo 6: `segmento`
- campo 7: `cnae`

#### Para clientes
- campo 1: `cnpj`
- campo 2: `razaoSocial`
- campo 3: `cnaePrincipal`
- campo 4: `descricaoCnae`
- campo 5: `uf`
- campo 6: `cidade`

### 5.2 Exportação em CSV para JSON

A rotina recomendada é:
1. exportar em CSV pelo ERP
2. limpar dados inconsistentes
3. transformar para JSON em array
4. validar CNPJ e campos obrigatórios
5. salvar em `prisma/data/sindicatos.json` e `prisma/data/clientes.json`

Exemplo de processo em Node.js:

```js
const dados = [
  {
    cnpj: '12345678000195',
    razaoSocial: 'Sindicato dos Trabalhadores da Indústria do Comércio',
    nomeFantasia: 'STIC',
    uf: 'SP',
    cidade: 'São Paulo',
    segmento: 'Comércio',
    cnae: '9420-1/00'
  }
];

const json = JSON.stringify(dados, null, 2);
```

---

## 6. Arquivos esperados na pasta `prisma/data`

Os arquivos devem ficar em:

```text
prisma/data/sindicatos.json
prisma/data/clientes.json
```

Se a pasta não existir, criar com a estrutura correta antes de rodar o seed.

---

## 7. Validação antes do upload

Antes de executar o seed, validar:

- [ ] todos os CNPJs têm 14 dígitos
- [ ] não há duplicidade por CNPJ
- [ ] `uf` está em maiúsculas
- [ ] `cidade` está correta e normalizada
- [ ] `cnae` não está vazio para clientes
- [ ] `sindicatos.json` tem apenas sindicatos relevantes
- [ ] `clientes.json` tem apenas matriz ou clientes ativos

---

## 8. Exemplo realista de importação

### `sindicatos.json`

```json
[
  {
    "cnpj": "12345678000195",
    "razaoSocial": "Sindicato dos Trabalhadores do Comércio de São Paulo",
    "nomeFantasia": "STCSP",
    "uf": "SP",
    "cidade": "São Paulo",
    "segmento": "Comércio",
    "cnae": "9420-1/00"
  },
  {
    "cnpj": "56123456000188",
    "razaoSocial": "Sindicato da Indústria Metalúrgica de Campinas",
    "nomeFantasia": "SIMC",
    "uf": "SP",
    "cidade": "Campinas",
    "segmento": "Metalurgia",
    "cnae": "9420-1/00"
  }
]
```

### `clientes.json`

```json
[
  {
    "cnpj": "11222333000144",
    "razaoSocial": "Empresa Exemplo Ltda",
    "cnaePrincipal": "4721101",
    "descricaoCnae": "Comércio varejista de mercadorias em geral",
    "uf": "SP",
    "cidade": "Campinas"
  },
  {
    "cnpj": "99887766000155",
    "razaoSocial": "Comércio Modelo S.A.",
    "cnaePrincipal": "4711301",
    "descricaoCnae": "Comércio varejista de artigos de vestuário",
    "uf": "SP",
    "cidade": "São Paulo"
  }
]
```

---

## 9. Como o seed usa esses dados

O arquivo `prisma/seed.ts` faz o seguinte:

1. carrega `sindicatos.json`
2. executa `upsert` por CNPJ
3. carrega `clientes.json`
4. executa `upsert` por CNPJ
5. tenta gerar o vínculo territorial por `uf + cidade`
6. cria `EnquadramentoSindical` com status `SUGERIDO_IA`

Esse fluxo permite que a fase inicial do sistema opere com dados básicos, sem exigir integração completa do ERP no momento do Go-Live.

---

## 10. Recomendação final

Para evitar inconsistência no início da operação:
- exporte primeiro a base de sindicatos e clientes ativos
- valide os CNPJs e a correção dos dados
- faça a importação em massa em ambiente homologação
- só então rodar no ambiente de produção

Esse procedimento reduz ruído e torna o vínculo territorial muito mais confiável.
