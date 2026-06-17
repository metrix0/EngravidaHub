# 📊 Engravida Insights

Dashboard com IA para analisar conversas entre atendentes e clientes, gerando métricas de resolução, satisfação, agendamento, momentos de perda e análise por unidade/serviço/atendente. Obtenção de mensagens para análises integrada à Blip.

Dashboard with AI to analyze conversations between attendants and clients, generating metrics on resolution, satisfaction, scheduling, loss moments, and analysis by unit/service/attendant. Message retrieval for analysis integrated with Blip.

## 🤖 Tech

- Next.js
- TypeScript
- Supabase
- Tailwind CSS
- Recharts
- Lucide React
- OpenAI API (gpt-5.5-nano)

## ✅ Architecture

[ New Message on Blip (Trigger) ] --> [ Supabase Database ]
[ Cron(30min)+API Separate Conversations that Ended ] --> [ API Route AI Analysis ] --> [ Supabase Database ] --> [ Dashboard Frontend ] and [ Meta and Google Events Tracking ]

Core entities are defined in `src/types`:

- `Client` — groups conversations from the same contact
- `Conversation` — one analyzed conversation/session
- `Message` — individual messages inside a conversation
- `ConversationAnalysis` — AI/analytics output
- `Attendant`, `Unit`, `Service` — dashboard filters and grouping

Main API routes:

```txt
/api/dashboard/executivo
/api/dashboard/atendentes
/api/dashboard/jornada
/api/analyze
/api/import
```

## 💬 UI Components

Reusable UI components live in:
```
src/components/ui

COMPONENTS SHOWCASE IN: localhost:3000/dev/ui
```

Components showcase are generated automatically with a Script + Husky.

## 🎨 Extras

- npm run ui (generates /dev/ui page)

- npm run headers (add directory headers to all files)