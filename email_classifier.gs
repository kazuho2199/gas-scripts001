/**
 * email_classifier.gs
 * Gmailの「要処理」ラベル付き未読メールをClaude APIで分類し、
 * スプレッドシートへ記録、Slackへ通知したうえでラベルを更新する。
 */

// ラベル名の定数
var LABEL_TODO = '要処理';
var LABEL_DONE = '処理済み';

// シート名の定数
var SHEET_LOG   = 'メールログ';
var SHEET_ERROR = 'エラーログ';

// Claude API 設定
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_MODEL   = 'claude-haiku-4-5'; // コストを抑えるためHaikuの最新版を使用
var CLAUDE_MAX_BODY_LENGTH = 4000; // 本文が長すぎる場合にAPIへ送る文字数を制限

/**
 * メイン処理：未読メール取得 → 分類 → シート記録 → Slack通知 → ラベル更新
 * 5分おきのトリガーから自動実行される。
 */
function classifyAndNotifyEmails() {
  try {
    var props = PropertiesService.getScriptProperties();
    var claudeApiKey   = props.getProperty('CLAUDE_API_KEY');
    var slackWebhookUrl = props.getProperty('SLACK_WEBHOOK_URL');

    if (!claudeApiKey || !slackWebhookUrl) {
      logError('スクリプトプロパティに CLAUDE_API_KEY または SLACK_WEBHOOK_URL が設定されていません。');
      return;
    }

    var todoLabel = GmailApp.getUserLabelByName(LABEL_TODO);
    if (!todoLabel) {
      logError('ラベル「' + LABEL_TODO + '」が見つかりません。Gmail側でラベルを作成してください。');
      return;
    }
    var doneLabel = getOrCreateLabel(LABEL_DONE);

    var threads = todoLabel.getThreads();

    threads.forEach(function(thread) {
      var unreadMessages = thread.getMessages().filter(function(message) {
        return message.isUnread();
      });

      if (unreadMessages.length === 0) return;

      // スレッド内の未読メールをすべて正常処理できた場合のみラベルを付け替える
      var allSucceeded = true;

      unreadMessages.forEach(function(message) {
        try {
          processMessage(message, claudeApiKey, slackWebhookUrl);
          message.markRead();
        } catch (e) {
          allSucceeded = false;
          logError('メール処理中にエラーが発生しました（件名: ' + message.getSubject() + '）: ' + e.message);
        }
      });

      if (allSucceeded) {
        thread.addLabel(doneLabel);
        thread.removeLabel(todoLabel);
      }
    });

    Logger.log('メール分類処理が完了しました。');
  } catch (e) {
    logError('classifyAndNotifyEmails 実行中に予期しないエラーが発生しました: ' + e.message);
  }
}

/**
 * 1件のメールを分類し、シート記録とSlack通知を行う。
 * @param {GmailMessage} message
 * @param {string} claudeApiKey
 * @param {string} slackWebhookUrl
 */
function processMessage(message, claudeApiKey, slackWebhookUrl) {
  var subject    = message.getSubject();
  var sender     = message.getFrom();
  var receivedAt = message.getDate();
  var body       = message.getPlainBody();

  var result   = classifyEmail(claudeApiKey, subject, body);
  var category = result.category;
  var summary  = result.summary;

  appendLogRow(receivedAt, sender, subject, category, summary);
  notifySlack(slackWebhookUrl, sender, subject, category, summary);
}

/**
 * Claude APIでメールを分類・要約する。
 * @param {string} apiKey
 * @param {string} subject
 * @param {string} body
 * @return {{category: string, summary: string}}
 */
function classifyEmail(apiKey, subject, body) {
  var truncatedBody = body.length > CLAUDE_MAX_BODY_LENGTH
    ? body.substring(0, CLAUDE_MAX_BODY_LENGTH) + '\n(以下省略)'
    : body;

  var prompt = 'あなたはカスタマーサポート担当者の代わりにメールを一次分類するアシスタントです。\n' +
    '以下のメールを読み、「クレーム」「質問」「注文」「その他」のいずれか1つに分類し、\n' +
    '日本語で50字程度の要約を作成してください。\n\n' +
    '件名: ' + subject + '\n' +
    '本文:\n' + truncatedBody;

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'user', content: prompt }
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['クレーム', '質問', '注文', 'その他'] },
            summary:  { type: 'string' }
          },
          required: ['category', 'summary'],
          additionalProperties: false
        }
      }
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response   = UrlFetchApp.fetch(CLAUDE_API_URL, options);
  var statusCode = response.getResponseCode();
  var bodyText   = response.getContentText();

  if (statusCode !== 200) {
    throw new Error('Claude APIエラー（status: ' + statusCode + '）: ' + bodyText);
  }

  var json = JSON.parse(bodyText);
  var textBlock = null;
  for (var i = 0; i < json.content.length; i++) {
    if (json.content[i].type === 'text') {
      textBlock = json.content[i];
      break;
    }
  }
  if (!textBlock) {
    throw new Error('Claude APIの応答にテキストブロックが含まれていません: ' + bodyText);
  }

  var parsed = JSON.parse(textBlock.text);
  return { category: parsed.category, summary: parsed.summary };
}

/**
 * 「メールログ」シートに1行追記する。ヘッダーがなければ作成する。
 * @param {Date} receivedAt
 * @param {string} sender
 * @param {string} subject
 * @param {string} category
 * @param {string} summary
 */
function appendLogRow(receivedAt, sender, subject, category, summary) {
  var sheet = getOrCreateSheet(SHEET_LOG, ['受信日時', '送信者', '件名', '分類', '要約']);
  sheet.appendRow([receivedAt, sender, subject, category, summary]);
}

/**
 * Slack Incoming Webhookで担当者に通知する。
 * @param {string} webhookUrl
 * @param {string} sender
 * @param {string} subject
 * @param {string} category
 * @param {string} summary
 */
function notifySlack(webhookUrl, sender, subject, category, summary) {
  var text = ':email: 新着メールを分類しました\n' +
    '*送信者:* ' + sender + '\n' +
    '*件名:* ' + subject + '\n' +
    '*分類:* ' + category + '\n' +
    '*要約:* ' + summary;

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(webhookUrl, options);
  if (response.getResponseCode() !== 200) {
    throw new Error('Slack通知に失敗しました（status: ' + response.getResponseCode() + '）: ' + response.getContentText());
  }
}

/**
 * 「エラーログ」シートにエラー内容を記録する。シート記録自体に失敗した場合は
 * GASの実行ログにフォールバック出力する。
 * @param {string} message
 */
function logError(message) {
  try {
    var sheet = getOrCreateSheet(SHEET_ERROR, ['発生日時', 'エラー内容']);
    sheet.appendRow([new Date(), message]);
  } catch (e) {
    Logger.log('エラーログの記録に失敗しました: ' + e.message);
  }
  Logger.log(message);
}

/**
 * 指定した名前のシートを取得する。存在しなければヘッダー付きで新規作成する。
 * @param {string} name
 * @param {Array<string>} headers
 * @return {Sheet}
 */
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

/**
 * 指定した名前のGmailラベルを取得する。存在しなければ新規作成する。
 * @param {string} name
 * @return {GmailLabel}
 */
function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}

/**
 * 5分おきの時間駆動トリガーを登録する。
 * ※ GASエディタでこの関数を【一度だけ】手動実行してください。
 *   以降は5分おきに classifyAndNotifyEmails() が自動実行されます。
 *   重複登録を防ぐため、既存の同名トリガーは事前に削除します。
 */
function setupEmailClassifierTrigger() {
  var functionName = 'classifyAndNotifyEmails';

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('既存のトリガーを削除しました。');
    }
  });

  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('5分おきのトリガーを登録しました。');
}
