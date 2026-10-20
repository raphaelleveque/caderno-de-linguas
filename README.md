# Caderno de Línguas

Plano diário de francês e espanhol (A2 → C1), feito como Artifact do Claude.

- Blocos de 10 minutos com questões abertas e fechadas, corrigidas no modo examinador.
- Revisão espaçada: cada erro volta em intervalos crescentes; a dificuldade é classificada automaticamente.
- Ditado com vozes nativas do aparelho (fr-FR e es-ES apenas).
- Redação com plano, escrita, correção, reescrita obrigatória e avaliação da escrita em geral.
- Registro de aula: o tema e os erros corrigidos pelo professor viram questões.
- Interface 100% na língua do dia.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `topics.js` | Temas por nível (A2–C1), categorias de erro, tipos de questão e tarefas de redação |
| `seed_fr.js`, `seed_es.js` | Banco inicial A2 escrito à mão |
| `i18n.js` | Textos da interface em francês e espanhol |
| `core.js` | Calendário, montagem dos blocos, revisão espaçada, correção local, estatísticas |
| `claude.js` | Prompts de correção, dúvida, contestação e geração de questões |
| `ui.js` | Interface e ações |
| `style.css`, `shell_head.html` | Estilo e cabeçalho da página |
| `build.py` | Junta tudo em `caderno.html` |

## Build

```
python3 build.py   # gera caderno.html
```

`caderno.html` é a página publicada como Artifact. Ela usa as capacidades `db`, `user` e `sample` do runtime de Artifacts do Claude: os dados ficam na pasta privada de cada usuário e as correções rodam na conta de quem usa. Não há chaves nem segredos no código.
