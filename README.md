# 📸 PhotoAPP - Gincana DROP

O **PhotoAPP** é uma plataforma web em tempo real desenvolvida para gerenciar gincanas fotográficas do grupo de jovens **DROP**. O projeto foi criado para proporcionar uma experiência interativa, onde equipes competem cumprindo missões fotográficas, enquanto a organização acompanha e avalia tudo em tempo real.

Este projeto foi desenvolvido em colaboração por **Arthur Emanuel Forster (Nottyzada)** e **Michel Bonazza**.

🚀 **Visualize o projeto online:** [nottyzada.github.io/PhotoAPP/](https://nottyzada.github.io/PhotoAPP/)

---

## 🌟 Funcionalidades Principais

A plataforma é dividida em três visões principais, cada uma otimizada para o seu propósito:

### 👥 Painel do Time

- **Missões em Tempo Real**: Recebimento instantâneo da missão atual assim que a anterior é processada.

- **Upload de Fotos**: Captura e envio de fotos diretamente do navegador (integração com Supabase Storage).

- **Status da Missão**: Acompanhamento do status (Pendente, Aprovado, Revisar ou Rejeitado).

- **Timer Global**: Sincronização com o cronômetro oficial da gincana.

### 🛡️ Painel Administrativo

- **Gestão de Missões**: Criação, edição e ativação de missões com diferentes níveis de dificuldade (Fácil, Médio, Difícil).

- **Avaliação Dinâmica**: Interface para aprovar ou rejeitar fotos, com opção de solicitar revisão e adicionar notas.

- **Controle de Pontuação**: Atribuição automática de pontos baseada na dificuldade e critérios extras (Criatividade, União, Respeito).

- **Controle do Cronômetro**: Iniciar, pausar e resetar o tempo global da gincana para todos os usuários.

### 📺 Painel TV (Dashboard)

- **Visualização Pública**: Interface otimizada para grandes telas, exibindo o cronômetro gigante e o progresso da competição.

- **Sincronização Total**: Atualizações instantâneas via WebSockets (Supabase Realtime).

---

## 🛠️ Tecnologias Utilizadas

O projeto utiliza uma stack moderna e focada em performance e tempo real:

- **Frontend**: HTML5, CSS3 (Variáveis, Flexbox, Grid, Animações) e JavaScript Vanilla.

- **Backend-as-a-Service**: [Supabase](https://supabase.com/)
  - **Database**: PostgreSQL para armazenamento de times, missões e submissões.
  - **Realtime**: Sincronização instantânea de dados entre Admin, Times e TV.
  - **Storage**: Armazenamento das fotos enviadas pelas equipes.
  - **Auth**: Sistema de login simplificado para as equipes.

- **Design**: Tipografia **Syne** para títulos impactantes e **Inter** para leitura, com uma identidade visual moderna baseada em tons de azul e roxo (DROP Identity).

---

## 📂 Estrutura do Repositório

```
PhotoAPP/
├── assets/images/   # Logos e ativos visuais da marca DROP
├── app.js           # Lógica principal, integração com Supabase e estados
├── index.html       # Estrutura das múltiplas visões (Login, Team, Admin, TV, Timeline)
├── styles.css       # Identidade visual completa e responsividade
└── .agents/         # Configurações de automação e desenvolvimento
```

---

## 🚀 Como Executar o Projeto

1. **Configuração do Supabase**:
  - Crie um projeto no Supabase.
  - Configure as tabelas `teams`, `missions`, `submissions` e `event_timer`.
  - Crie um bucket de storage chamado `photos`.
  - No arquivo `app.js`, substitua `SUPABASE_URL` e `SUPABASE_ANON_KEY` pelas suas credenciais.

1. **Hospedagem**:
  - O projeto pode ser servido estaticamente em qualquer provedor (GitHub Pages, Vercel, Netlify).

1. **Acesso**:
  - **Times**: Login via página principal.
  - **TV**: Adicione `#tv` ao final da URL.
  - **Timeline**: Adicione `#timeline` ao final da URL (requer login admin).

---

## 👥 Créditos

Desenvolvido com 💙 por:

- **Arthur Emanuel Forster** - [GitHub](https://github.com/Nottyzada)

- **Michel Bonazza** - [GitHub](https://github.com/michelbonazza)

---

© 2026 DROP - Gincana ao Vivo
