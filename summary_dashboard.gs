/**
 * summary_dashboard.gs
 * 売上データを月ごとに集計し、月次サマリーシートへ書き込む。
 * 棒グラフで月次推移を可視化する。
 */

// シート名の定数
var SHEET_DATA    = '売上データ';
var SHEET_SUMMARY = '月次サマリー';

/**
 * メイン処理：集計 → サマリー書き込み → グラフ更新
 * 毎朝9時のトリガーから自動実行される。
 */
function runSummaryDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var monthly = aggregateSalesByMonth(ss);
  writeSummary(ss, monthly);
  updateChart(ss);

  Logger.log('月次サマリーの更新が完了しました。');
}

/**
 * 「売上データ」シートを読み込み、月ごとに合計売上と件数を集計する。
 * @param {Spreadsheet} ss
 * @return {Array<{month: string, total: number, count: number}>} 月順にソートした集計結果
 */
function aggregateSalesByMonth(ss) {
  var sheet = ss.getSheetByName(SHEET_DATA);
  if (!sheet) {
    throw new Error('"' + SHEET_DATA + '" シートが見つかりません。');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    // ヘッダーのみ、またはデータなし
    return [];
  }

  // 2行目以降（ヘッダーを除く）のデータを一括取得
  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

  // 月キー → {total, count} のマップ
  var map = {};

  values.forEach(function(row) {
    var dateCell = row[0]; // A列：日付
    var amount   = row[3]; // D列：金額

    // 日付が空またはDateでない行はスキップ
    if (!dateCell || !(dateCell instanceof Date)) return;

    // 金額が数値でない行はスキップ
    if (typeof amount !== 'number' || isNaN(amount)) return;

    // "2026年1月" 形式のキーを生成
    var year  = dateCell.getFullYear();
    var month = dateCell.getMonth() + 1; // 0始まりを補正
    var key   = year + '年' + month + '月';

    if (!map[key]) {
      // ソート用に年・月の数値も保持する
      map[key] = { month: key, total: 0, count: 0, year: year, monthNum: month };
    }
    map[key].total += amount;
    map[key].count += 1;
  });

  // 年・月の昇順にソートして配列化
  var result = Object.values(map).sort(function(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    return a.monthNum - b.monthNum;
  });

  return result;
}

/**
 * 「月次サマリー」シートをクリアしてヘッダーと集計データを書き込む。
 * @param {Spreadsheet} ss
 * @param {Array} monthly - aggregateSalesByMonth の戻り値
 */
function writeSummary(ss, monthly) {
  var sheet = ss.getSheetByName(SHEET_SUMMARY);

  // シートが存在しなければ新規作成
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SUMMARY);
  }

  // 既存の内容を全消去
  sheet.clearContents();

  // ヘッダー行
  sheet.getRange(1, 1, 1, 3).setValues([['月', '合計売上', '件数']]);

  if (monthly.length === 0) {
    Logger.log('集計対象のデータがありません。');
    return;
  }

  // データ行を一括書き込み
  var rows = monthly.map(function(item) {
    return [item.month, item.total, item.count];
  });
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);

  // 合計売上列を通貨フォーマットに設定
  sheet.getRange(2, 2, rows.length, 1).setNumberFormat('¥#,##0');

  Logger.log('月次サマリーに ' + rows.length + ' 件の月を書き込みました。');
}

/**
 * 「月次サマリー」シートのデータをもとに棒グラフを作成・更新する。
 * 既存のグラフがあれば差し替え、なければ新規作成する。
 * @param {Spreadsheet} ss
 */
function updateChart(ss) {
  var sheet = ss.getSheetByName(SHEET_SUMMARY);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('グラフ作成に必要なデータがありません。');
    return;
  }

  // グラフのデータ範囲：A列（月）とB列（合計売上）
  var dataRange = sheet.getRange(1, 1, lastRow, 2);

  // 既存グラフの取得（最初の1つを再利用）
  var charts   = sheet.getCharts();
  var builder;

  if (charts.length > 0) {
    // 既存グラフを更新
    builder = charts[0].modify();
    // 既存のデータ範囲を一度除去してから再設定
    builder = builder.clearRanges().addRange(dataRange);
  } else {
    // 新規グラフを作成
    builder = sheet.newChart().addRange(dataRange);
  }

  var chart = builder
    .setChartType(Charts.ChartType.COLUMN) // 縦棒グラフ
    .setOption('title', '月次売上推移')
    .setOption('hAxis.title', '月')
    .setOption('vAxis.title', '売上金額（円）')
    .setOption('legend', { position: 'none' })
    .setPosition(2, 5, 0, 0)  // 2行目・E列あたりに配置
    .build();

  if (charts.length > 0) {
    sheet.updateChart(chart);
    Logger.log('既存のグラフを更新しました。');
  } else {
    sheet.insertChart(chart);
    Logger.log('新しいグラフを作成しました。');
  }
}

/**
 * 毎朝9時の時間駆動トリガーを登録する。
 * ※ GASエディタでこの関数を【一度だけ】手動実行してください。
 *   以降は毎朝9時に runSummaryDashboard() が自動実行されます。
 *   重複登録を防ぐため、既存のトリガーは事前に削除します。
 */
function setupDailyTrigger() {
  var functionName = 'runSummaryDashboard';

  // 同名の既存トリガーをすべて削除して重複を防ぐ
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('既存のトリガーを削除しました。');
    }
  });

  // 毎朝 9:00〜10:00 の間に実行するトリガーを登録
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log('毎朝9時のトリガーを登録しました。');
}
