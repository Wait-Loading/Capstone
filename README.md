# 🧠 AI Procedure Generation Feature – TaskTrain

This feature adds **AI-assisted procedure creation** to the TaskTrain platform. Users can dynamically generate structured procedures by interacting with a chat-based interface powered by **Amazon Bedrock** (Claude model). The system collects user responses through guided questions and outputs a complete procedure document in TaskTrain format.

> **Note:** Due to NDA constraints, backend integrations and sensitive files are excluded. This README focuses on the front-end architecture and AWS Bedrock interaction layer.

---

## 🚀 Feature Overview

With this feature, users can:
- Launch **"AI Generate Procedure"** from the procedure creation UI.
- Interact with an AI-powered chat interface.
- Answer dynamic follow-up questions.
- Receive a fully generated procedure that includes:
  - **What**
  - **Why**
  - **Who**
  - **When**
  - **Where**
  - **With What**
  - **Steps**
  - Related procedures, safety notes, tools, and roles

This accelerates SOP creation, ensures format compliance, and reduces manual effort.

---

## 🧩 Architecture & Components

### 🔹 `ProcedureCreateAiComponent`

A standalone Angular component responsible for:
- Rendering the floating chat dialog.
- Asking one question at a time.
- Collecting and validating user input.
- Triggering the final procedure generation.

### 🔹 `TextGenerationService`

This service handles:
- Bedrock client initialization using secured credentials.
- Prompt engineering for both question generation and final content generation.
- Maintaining interaction state:
  - Follow-up questions
  - Current index
  - User response map
  - Edit mode support
- Switching between edit and generation modes.

---

## 🧠 AI Workflow

1. User selects **AI Generate Procedure**.
2. Component prompts user for procedure description.
3. System generates contextual follow-up questions using Claude.
4. User answers each follow-up question.
5. On completion, all responses are sent to Claude to generate the final procedure.
6. Output can be rendered as:
   - Rich HTML preview
   - JSON object to pass to `ProcedureCreate` mutation

---

## ⚙️ Technologies Used

- **Angular 16+**
- **RxJS** for reactive programming
- **Amazon Bedrock** (Claude)
- **TaskTrain Core APIs** *(under NDA)*

---

## 📁 File Structure

```plaintext
src/
├── app/
│   ├── procedure-create-ai/
│   │   ├── procedure-create-ai.component.ts      # Chat-based procedure builder
│   │   ├── procedure-create-ai.component.html    # UI template
│   │   ├── procedure-create-ai.component.scss    # Chat styles and layout
│   ├── services/
│   │   ├── text-generation.service.ts            # Handles AI logic and Bedrock integration
