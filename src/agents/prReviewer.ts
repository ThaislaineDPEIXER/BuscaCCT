import * as core from '@actions/core';
import * as github from '@actions/github';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MAX_DIFF_LENGTH = 120_000;
const COMMENT_MARKER = '## 🤖 Revisão Arquitetural Automatizada';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

async function loadPullRequestDiff(token: string, owner: string, repo: string, pullNumber: number): Promise<string> {
  const octokit = github.getOctokit(token);
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100
  });

  if (files.length === 0) {
    return 'Nenhuma alteração textual encontrada no pull request.';
  }

  const diffSections: string[] = [];
  let currentLength = 0;

  for (const file of files) {
    const header = [
      `Arquivo: ${file.filename}`,
      `Status: ${file.status}`,
      `Adições: ${file.additions}`,
      `Remoções: ${file.deletions}`
    ].join('\n');
    const patch = file.patch ?? '[Sem patch textual disponível para este arquivo]';
    const section = `${header}\nPatch:\n${patch}\n`;

    if (currentLength + section.length > MAX_DIFF_LENGTH) {
      diffSections.push('\n[Diff truncado para caber no limite de análise.]');
      break;
    }

    diffSections.push(section);
    currentLength += section.length;
  }

  return diffSections.join('\n---\n');
}

async function analyzeDiff(diffText: string): Promise<string> {
  const geminiApiKey = requireEnv('GEMINI_API_KEY');
  const client = new GoogleGenerativeAI(geminiApiKey);
  const model = client.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash' });

  const prompt = [
    'Você é um Arquiteto de Software revisando um Pull Request.',
    'Analise o diff abaixo e seja conciso.',
    'Valide obrigatoriamente:',
    '- tipagem estrita em TypeScript;',
    '- uso correto de transações do Prisma, com atenção especial a operações em lote;',
    '- práticas de segurança, incluindo segredos, validação de entrada e superfícies de ataque;',
    'Se não houver problemas relevantes, diga claramente que não encontrou bloqueios arquiteturais.',
    'Responda em português do Brasil em tópicos curtos.',
    '',
    'Diff do Pull Request:',
    diffText
  ].join('\n');

  const result = await model.generateContent(prompt);
  const response = result.response.text().trim();

  if (!response) {
    return 'O Gemini não retornou observações para este Pull Request.';
  }

  return response;
}

async function upsertReviewComment(token: string, owner: string, repo: string, pullNumber: number, body: string): Promise<void> {
  const octokit = github.getOctokit(token);
  const authenticatedUser = await octokit.rest.users.getAuthenticated();
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100
  });

  const existingComment = comments.find(comment =>
    comment.user?.login === authenticatedUser.data.login && comment.body?.startsWith(COMMENT_MARKER)
  );

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body
    });
    return;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body
  });
}

async function main(): Promise<void> {
  if (!['pull_request', 'pull_request_target'].includes(github.context.eventName)) {
    core.info('Evento atual não é pull_request; encerrando agente.');
    return;
  }

  const pullNumber = github.context.payload.pull_request?.number;
  if (typeof pullNumber !== 'number') {
    throw new Error('Número do Pull Request não encontrado no contexto do GitHub Actions.');
  }

  const token = requireEnv('GITHUB_TOKEN');
  const { owner, repo } = github.context.repo;

  const diffText = await loadPullRequestDiff(token, owner, repo, pullNumber);
  const review = await analyzeDiff(diffText);
  const commentBody = `${COMMENT_MARKER}\n\n${review}`;

  await upsertReviewComment(token, owner, repo, pullNumber, commentBody);
  core.info(`Comentário publicado no Pull Request #${pullNumber}.`);
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : 'Falha desconhecida no agente de revisão.';
  core.setFailed(message);
});
