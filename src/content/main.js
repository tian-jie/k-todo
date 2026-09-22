(function () {
  var state = {
    dashboard: null,
    todos: [],
    pollingTimer: null,
    clockTimer: null,
    clockAlignTimer: null,
    lunarText: "农历待接入",
    backendWeekday: "",
    backendClockMs: 0,
    backendSyncLocalMs: 0,
    useBackendClock: false
  };

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function toWeekdayZh(dayIndex) {
    var names = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    return names[dayIndex] || "星期一";
  }

  function parseBackendDateTime(dateText, timeText) {
    var d = (dateText || "").toString();
    var t = (timeText || "").toString();
    var m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    var hm = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m || !hm) {
      return null;
    }

    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10) - 1;
    var da = parseInt(m[3], 10);
    var h = parseInt(hm[1], 10);
    var mi = parseInt(hm[2], 10);
    var se = hm[3] ? parseInt(hm[3], 10) : 0;

    if (isNaN(y) || isNaN(mo) || isNaN(da) || isNaN(h) || isNaN(mi) || isNaN(se)) {
      return null;
    }

    return new Date(y, mo, da, h, mi, se, 0);
  }

  function updateRealtimeClock() {
    var now;
    if (state.useBackendClock) {
      now = new Date(state.backendClockMs + (new Date().getTime() - state.backendSyncLocalMs));
    } else {
      now = new Date();
    }

    byId("dateText").innerHTML =
      now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
    byId("clockText").innerHTML = pad2(now.getHours()) + ":" + pad2(now.getMinutes());
    byId("weekdayText").innerHTML = state.backendWeekday || toWeekdayZh(now.getDay());
    byId("lunarText").innerHTML = state.lunarText || "农历待接入";
  }

  function startClock() {
    if (state.clockTimer) {
      clearInterval(state.clockTimer);
      state.clockTimer = null;
    }
    if (state.clockAlignTimer) {
      clearTimeout(state.clockAlignTimer);
      state.clockAlignTimer = null;
    }

    updateRealtimeClock();

    var nowMs = new Date().getTime();
    var msToNextMinute = 60000 - (nowMs % 60000);
    state.clockAlignTimer = setTimeout(function () {
      updateRealtimeClock();
      state.clockTimer = setInterval(function () {
        updateRealtimeClock();
      }, 60000);
    }, msToNextMinute);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    var bar = byId("statusBar");
    if (!bar) {
      return;
    }
    bar.style.display = "block";
    bar.innerHTML = text;
  }

  function hardRefresh(e) {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    try {
      localStorage.removeItem(KTODO_CONFIG.CACHE_KEY);
    } catch (err) {
      /* ignore cache clear errors */
    }
    window.location.href = "index.html?r=" + new Date().getTime();
    return false;
  }

  function showDashboard() {
    byId("dashboardView").className = "view active";
    byId("boardView").className = "view";
  }

  function showBoard() {
    byId("dashboardView").className = "view";
    byId("boardView").className = "view active";
  }

  function saveCache(payload) {
    try {
      localStorage.setItem(KTODO_CONFIG.CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      setStatus("缓存写入失败");
    }
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(KTODO_CONFIG.CACHE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function xhr(method, path, payload, onOk, onErr) {
    var req = new XMLHttpRequest();
    var url = KTODO_CONFIG.API_BASE + path;
    req.open(method, url, true);
    req.timeout = KTODO_CONFIG.REQUEST_TIMEOUT_MS;
    req.setRequestHeader("Content-Type", "application/json");

    req.onreadystatechange = function () {
      if (req.readyState !== 4) {
        return;
      }
      if (req.status >= 200 && req.status < 300) {
        var parsed;
        try {
          parsed = req.responseText ? JSON.parse(req.responseText) : {};
        } catch (err) {
          onErr("响应解析失败");
          return;
        }
        onOk(parsed);
      } else {
        onErr("HTTP " + req.status);
      }
    };

    req.ontimeout = function () {
      onErr("请求超时");
    };

    req.onerror = function () {
      onErr("网络错误");
    };

    req.send(payload ? JSON.stringify(payload) : null);
  }

  function pickQuadrant(todo) {
    if (todo.urgent && todo.important) {
      return "q1";
    }
    if (!todo.urgent && todo.important) {
      return "q2";
    }
    if (todo.urgent && !todo.important) {
      return "q3";
    }
    return "q4";
  }

  function clearLists() {
    byId("q1").innerHTML = "";
    byId("q2").innerHTML = "";
    byId("q3").innerHTML = "";
    byId("q4").innerHTML = "";
  }

  function createTodoNode(todo) {
    var li = document.createElement("li");
    li.className = "todo-item";

    var title = document.createElement("span");
    title.className = "todo-title";
    title.innerHTML = todo.title;

    var btn = document.createElement("button");
    btn.className = "todo-btn";
    btn.innerHTML = todo.done ? "DONE" : "done";
    btn.disabled = !!todo.done;
    btn.onclick = function (e) {
      if (e && e.stopPropagation) {
        e.stopPropagation();
      }
      markDone(todo.id);
      return false;
    };

    li.appendChild(title);
    li.appendChild(btn);
    return li;
  }

  function renderTodos() {
    var i;
    clearLists();
    for (i = 0; i < state.todos.length; i++) {
      var todo = state.todos[i];
      if (todo.done) {
        continue;
      }
      byId(pickQuadrant(todo)).appendChild(createTodoNode(todo));
    }
  }

  function parseHourLabel(text) {
    var s = (text || "").toString();
    var idx = s.indexOf(":");
    if (idx > 0) {
      s = s.substring(0, idx);
    }
    var h = parseInt(s, 10);
    if (isNaN(h) || h < 0 || h > 23) {
      return -1;
    }
    return h;
  }

  function hourFromItem(item) {
    var h = parseHourLabel(item.hour);
    if (h >= 0) {
      return h;
    }

    if (item.fxTime) {
      h = new Date(item.fxTime).getHours();
      if (!isNaN(h)) {
        return h;
      }
    }

    if (item.fx_time) {
      h = new Date(item.fx_time).getHours();
      if (!isNaN(h)) {
        return h;
      }
    }

    return -1;
  }

  function weatherSymbol(item) {
    var iconCode = (item.icon || item.icon_code || "").toString();
    var text = (item.text || item.textDay || item.weather || "").toString();

    if (/雪/.test(text) || /^4\d\d$/.test(iconCode)) {
      return "❄";
    }
    if (/雨|雷|阵雨/.test(text) || /^3\d\d$/.test(iconCode)) {
      return "☂";
    }
    if (/晴/.test(text) || iconCode === "100") {
      return "☀";
    }
    if (/阴|云/.test(text) || /^10[1-4]$/.test(iconCode)) {
      return "☁";
    }
    return "☁";
  }

  function pickHourItem(items, hour, fallbackIndex) {
    var i;
    for (i = 0; i < items.length; i++) {
      if (hourFromItem(items[i]) === hour) {
        return items[i];
      }
    }
    if (!items.length) {
      return {};
    }
    return items[fallbackIndex % items.length];
  }

  function buildNext24hSlots(items) {
    var slots = [];
    var now = new Date();
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
    var i;
    for (i = 0; i < 24; i++) {
      var dt = new Date(base.getTime() + i * 60 * 60 * 1000);
      var h = dt.getHours();
      var raw = pickHourItem(items, h, i);
      var tempVal = raw.temp;
      if (tempVal === undefined || tempVal === null || tempVal === "") {
        tempVal = "--";
      }
      slots.push({
        hour: h === 0 ? formatMonthDaySimple(dt) : (h + "点"),
        temp: tempVal,
        text: raw.text || raw.weather || "--",
        windDir: raw.windDir || raw.wind_dir || "--",
        windScale: raw.windScale || raw.wind_scale || "--",
        icon: weatherSymbol(raw)
      });
    }
    return slots;
  }

  function renderWeather24(items) {
    var headEl = byId("weather24Head");
    var chartEl = byId("weather24Chart");
    var full = buildNext24hSlots(items || []);
    var list = [];
    var headHtml = "";
    var i;

    if (!headEl || !chartEl) {
      return;
    }

    for (i = 0; i < full.length; i += 2) {
      list.push(full[i]);
    }

    if (!list.length) {
      headEl.innerHTML = "";
      chartEl.innerHTML = "";
      return;
    }

    var colWidth = 100 / list.length;
    for (i = 0; i < list.length; i++) {
      headHtml += '<span class="weather-24-head-item" style="width:' + colWidth.toFixed(4) + '%;">' +
        '<span class="weather-24-head-time">' + list[i].hour + '</span>' +
        '<span class="weather-24-head-icon">' + list[i].icon + '</span>' +
        '<span class="weather-24-head-text">' + list[i].text + '</span>' +
        '</span>';
    }
    headEl.innerHTML = headHtml;

    var temps = [];
    var prevTemp = 22;
    for (i = 0; i < list.length; i++) {
      var t = parseInt(list[i].temp, 10);
      if (isNaN(t)) {
        t = prevTemp;
      }
      prevTemp = t;
      temps.push(t);
    }

    var minTemp = 999;
    var maxTemp = -999;
    for (i = 0; i < temps.length; i++) {
      if (temps[i] < minTemp) {
        minTemp = temps[i];
      }
      if (temps[i] > maxTemp) {
        maxTemp = temps[i];
      }
    }
    minTemp = minTemp - 1;
    maxTemp = maxTemp + 1;
    if (maxTemp <= minTemp) {
      maxTemp = minTemp + 4;
    }

    var width = chartEl.clientWidth;
    if (!width || width < 100) {
      width = 900;
    }
    var height = 72;
    var left = 24;
    var top = 28;
    var plotWidth = width - left - 12;
    var plotHeight = height - top - 10;
    if (plotWidth < 20) {
      plotWidth = 20;
    }

    var pts = buildPolylinePoints(list, temps, left, top, plotWidth, plotHeight, minTemp, maxTemp);
    var path = "";
    var labels = "";
    var marks = "";
    for (i = 0; i < pts.length; i++) {
      path += (i === 0 ? "" : " ") + pts[i].x.toFixed(1) + "," + pts[i].y.toFixed(1);
      marks += '<circle cx="' + pts[i].x.toFixed(1) + '" cy="' + pts[i].y.toFixed(1) + '" r="2.6" fill="#111" />';
      labels += '<text x="' + pts[i].x.toFixed(1) + '" y="' + (pts[i].y - 6).toFixed(1) + '" text-anchor="middle" fill="#111">' +
        '<tspan font-size="30">' + temps[i] + '</tspan>' +
        '<tspan font-size="12">℃</tspan>' +
        '</text>';
    }

    var grid = "";
    var g;
    for (g = 0; g <= 4; g++) {
      var gy = top + (plotHeight * g) / 4;
      grid += '<line x1="' + left + '" y1="' + gy.toFixed(1) + '" x2="' + (left + plotWidth) + '" y2="' + gy.toFixed(1) + '" stroke="#d0d0d0" stroke-width="1" />';
    }

    chartEl.innerHTML = '' +
      '<svg width="100%" height="72" viewBox="0 0 ' + width + ' 72" xmlns="http://www.w3.org/2000/svg">' +
      grid +
      '<polyline fill="none" stroke="#111" stroke-width="3" points="' + path + '" />' +
      marks +
      labels +
      '</svg>';
  }

  function formatMonthDay(dt) {
    return pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  function formatMonthDaySimple(dt) {
    return (dt.getMonth() + 1) + "-" + dt.getDate();
  }

  function normalizeMonthDay(text) {
    var s = (text || "").toString();
    var m = s.match(/(\d{1,2})-(\d{1,2})$/);
    if (!m) {
      m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) {
        return s;
      }
      return parseInt(m[2], 10) + "-" + parseInt(m[3], 10);
    }
    return parseInt(m[1], 10) + "-" + parseInt(m[2], 10);
  }

  function dayLabelForOffset(offset, dayIndex) {
    if (offset === -1) {
      return "昨天";
    }
    if (offset === 0) {
      return "今天";
    }
    if (offset === 1) {
      return "明天";
    }
    var names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return names[dayIndex] || "周一";
  }

  function pickDayItem(items, label, fallbackIndex) {
    var i;
    var key = normalizeMonthDay(label);
    for (i = 0; i < items.length; i++) {
      if (normalizeMonthDay(items[i].date) === key) {
        return items[i];
      }
    }
    if (!items.length) {
      return {
        date: label,
        text: "--",
        high: "--",
        low: "--"
      };
    }
    return {
      date: label,
      text: items[fallbackIndex % items.length].text || items[fallbackIndex % items.length].textDay || "--",
      high: items[fallbackIndex % items.length].high,
      low: items[fallbackIndex % items.length].low,
      windScale: items[fallbackIndex % items.length].windScale || items[fallbackIndex % items.length].windScaleDay || "--",
      icon: items[fallbackIndex % items.length].icon || ""
    };
  }

  function buildNext15Days(items) {
    var list = [];
    var now = new Date();
    var i;
    for (i = -1; i <= 12; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      var label = formatMonthDaySimple(d);
      var raw = pickDayItem(items, label, i + 1);
      list.push({
        dayLabel: dayLabelForOffset(i, d.getDay()),
        date: label,
        text: raw.text || raw.textDay || "--",
        icon: weatherSymbol(raw),
        windScale: raw.windScale || raw.windScaleDay || raw.wind_scale || "--",
        high: raw.high,
        low: raw.low
      });
    }
    return list;
  }

  function toTempNumber(val, fallback) {
    var n = parseInt(val, 10);
    if (isNaN(n)) {
      return fallback;
    }
    return n;
  }

  function renderWeather15Head(list) {
    var labelsEl = byId("weather15Head");
    var html = "";
    var i;
    for (i = 0; i < list.length; i++) {
      var extraClass = "";
      if (list[i].dayLabel === "昨天") {
        extraClass = " weather-15-head-item-yesterday";
      } else if (list[i].dayLabel === "今天") {
        extraClass = " weather-15-head-item-today";
      }

      html += '<span class="weather-15-head-item' + extraClass + '">' +
        '<span class="weather-15-head-day">' + list[i].dayLabel + '</span>' +
        '<span class="weather-15-head-date">' + list[i].date + '</span>' +
        '<span class="weather-15-head-icon">' + list[i].icon + '</span>' +
        '<span class="weather-15-head-wind">' + list[i].windScale + '级</span>' +
        '</span>';
    }
    labelsEl.innerHTML = html;
  }

  function buildPolylinePoints(list, values, left, top, width, height, minTemp, maxTemp) {
    var pts = [];
    var i;
    var stepX = list.length > 1 ? width / (list.length - 1) : 0;
    var range = maxTemp - minTemp;
    if (range <= 0) {
      range = 1;
    }
    for (i = 0; i < list.length; i++) {
      var x = left + stepX * i;
      var y = top + ((maxTemp - values[i]) * height) / range;
      pts.push({ x: x, y: y, v: values[i] });
    }
    return pts;
  }

  function renderWeather14(items) {
    var chartEl = byId("weather15Chart");
    var list = buildNext15Days(items || []);
    var highs = [];
    var lows = [];
    var i;

    for (i = 0; i < list.length; i++) {
      highs.push(toTempNumber(list[i].high, 30));
      lows.push(toTempNumber(list[i].low, 20));
    }

    var minTemp = 999;
    var maxTemp = -999;
    for (i = 0; i < highs.length; i++) {
      if (highs[i] > maxTemp) {
        maxTemp = highs[i];
      }
      if (lows[i] < minTemp) {
        minTemp = lows[i];
      }
    }
    minTemp = minTemp - 1;
    maxTemp = maxTemp + 1;
    if (maxTemp <= minTemp) {
      maxTemp = minTemp + 4;
    }

    var width = chartEl.clientWidth;
    if (!width || width < 100) {
      width = 900;
    }
    var height = 120;
    var left = 22;
    var top = 22;
    var plotWidth = width - left - 12;
    var plotHeight = height - top - 22;
    if (plotWidth < 20) {
      plotWidth = 20;
    }

    var highPts = buildPolylinePoints(list, highs, left, top, plotWidth, plotHeight, minTemp, maxTemp);
    var lowPts = buildPolylinePoints(list, lows, left, top, plotWidth, plotHeight, minTemp, maxTemp);

    var highPath = "";
    var lowPath = "";
    var pointMarks = "";
    var tempLabels = "";
    for (i = 0; i < list.length; i++) {
      highPath += (i === 0 ? "" : " ") + highPts[i].x.toFixed(1) + "," + highPts[i].y.toFixed(1);
      lowPath += (i === 0 ? "" : " ") + lowPts[i].x.toFixed(1) + "," + lowPts[i].y.toFixed(1);
      pointMarks += '<circle cx="' + highPts[i].x.toFixed(1) + '" cy="' + highPts[i].y.toFixed(1) + '" r="2.5" fill="#111" />';
      pointMarks += '<circle cx="' + lowPts[i].x.toFixed(1) + '" cy="' + lowPts[i].y.toFixed(1) + '" r="2" fill="#555" />';

      tempLabels += '<text x="' + highPts[i].x.toFixed(1) + '" y="' + (highPts[i].y - 5).toFixed(1) + '" font-size="14" text-anchor="middle" fill="#111">' + highs[i] + '℃</text>';
      tempLabels += '<text x="' + lowPts[i].x.toFixed(1) + '" y="' + (lowPts[i].y + 13).toFixed(1) + '" font-size="14" text-anchor="middle" fill="#555">' + lows[i] + '℃</text>';
    }

    var grid = "";
    var dayBands = "";
    var g;

    var colWidth = width / list.length;
    for (i = 0; i < list.length; i++) {
      if (list[i].dayLabel === "今天") {
        dayBands += '<rect x="' + (colWidth * i).toFixed(1) + '" y="0" width="' + colWidth.toFixed(1) + '" height="' + height + '" fill="#d0d0d0" />';
      }
    }

    for (g = 0; g <= 4; g++) {
      var gy = top + (plotHeight * g) / 4;
      grid += '<line x1="' + left + '" y1="' + gy.toFixed(1) + '" x2="' + (left + plotWidth) + '" y2="' + gy.toFixed(1) + '" stroke="#d0d0d0" stroke-width="1" />';
    }

    chartEl.innerHTML = '' +
      '<svg width="100%" height="120" viewBox="0 0 ' + width + ' 120" xmlns="http://www.w3.org/2000/svg">' +
      dayBands +
      grid +
      '<polyline fill="none" stroke="#111" stroke-width="3" points="' + highPath + '" />' +
      '<polyline fill="none" stroke="#555" stroke-width="2" stroke-dasharray="5 3" points="' + lowPath + '" />' +
      pointMarks +
      tempLabels +
      '</svg>';

    renderWeather15Head(list);
  }

  function renderHomeCards(items) {
    var el = byId("homeCards");
    var html = "";
    var i;
    for (i = 0; i < items.length; i++) {
      html += '<li class="home-item">- ' + items[i] + '</li>';
    }
    el.innerHTML = html;
  }

  function renderTodoPreview(items) {
    var el = byId("todoPreviewList");
    var html = "";
    var i;
    for (i = 0; i < items.length; i++) {
      html += '<li class="todo-preview-item">' + items[i].title + '</li>';
    }
    el.innerHTML = html;
  }

  function renderDashboard(data) {
    var calendar = data.calendar || {};
    var weatherNow = data.weather_now || {};
    var weather24 = data.weather_24h || [];
    var weather14 = data.weather_14d || [];
    var todoSummary = data.todo_summary || {};
    var todoPreview = data.todo_preview || [];

    state.lunarText = calendar.lunar || "农历待接入";
    state.backendWeekday = calendar.weekday || "";

    var backendNow = parseBackendDateTime(calendar.date, calendar.time);
    if (backendNow) {
      state.backendClockMs = backendNow.getTime();
      state.backendSyncLocalMs = new Date().getTime();
      state.useBackendClock = true;
    } else {
      state.useBackendClock = false;
    }

    updateRealtimeClock();

    var hi = "--";
    var low = "--";
    if (weather14 && weather14.length > 0) {
      hi = weather14[0].high !== undefined ? weather14[0].high : "--";
      low = weather14[0].low !== undefined ? weather14[0].low : "--";
    }

    byId("weatherHeroIcon").innerHTML = weatherSymbol({
      icon: weatherNow.icon || weatherNow.icon_code,
      text: weatherNow.text
    });
    byId("weatherHeroTemp").innerHTML = weatherNow.temp !== undefined ? weatherNow.temp : "--";
    byId("weatherHeroRange").innerHTML = low + " / " + hi + " ℃";
    byId("weatherHeroWind").innerHTML = weatherNow.wind || "--";

    renderWeather24(weather24);
    renderWeather14(weather14);
    renderTodoPreview(todoPreview);

    byId("todoSummaryText").innerHTML =
      "待办：" + (todoSummary.pending || 0) +
      " / 总计：" + (todoSummary.total || 0) +
      "  Q1:" + (todoSummary.q1 || 0) +
      " Q2:" + (todoSummary.q2 || 0) +
      " Q3:" + (todoSummary.q3 || 0) +
      " Q4:" + (todoSummary.q4 || 0);
  }

  function applyDashboardPayload(payload) {
    state.dashboard = payload;
    state.todos = payload.todos || [];
    renderDashboard(payload);
    renderTodos();
  }

  function fetchDashboard() {
    setStatus("同步首页中... " + KindleSDK.nowISO());
    xhr("GET", "/api/v1/dashboard?device_id=" + encodeURIComponent(KTODO_CONFIG.DEVICE_ID), null, function (res) {
      applyDashboardPayload(res);
      saveCache(res);
      setStatus("首页同步成功 " + KindleSDK.nowISO());
    }, function (msg) {
      var cached = loadCache();
      if (cached) {
        applyDashboardPayload(cached);
        setStatus("同步失败(" + msg + ")，已使用缓存");
      } else {
        setStatus("同步失败(" + msg + ")，无缓存");
      }
    });
  }

  function markDone(id) {
    setStatus("提交 done... " + id);
    xhr("POST", "/api/v1/todos/" + id + "/done", {
      device_id: KTODO_CONFIG.DEVICE_ID
    }, function () {
      fetchDashboard();
      setStatus("done 成功 " + id);
    }, function (msg) {
      setStatus("done 失败(" + msg + ")");
    });
  }

  function startPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
    }
    state.pollingTimer = setInterval(function () {
      fetchDashboard();
    }, KTODO_CONFIG.POLL_MS);
  }

  function seedLocalMockIfNeeded() {
    var cached = loadCache();
    if (cached) {
      applyDashboardPayload(cached);
      return;
    }

    applyDashboardPayload({
      calendar: {
        date: "2026-09-21",
        time: "08:00",
        weekday: "星期一",
        lunar: "农历八月初一"
      },
      weather_now: {
        temp: 26,
        text: "多云",
        feels_like: 27,
        humidity: 65,
        wind: "东风2级"
      },
      weather_24h: [
        { hour: "09:00", temp: 26, text: "多云", icon: "101", windDir: "东北风", windScale: "2" },
        { hour: "12:00", temp: 28, text: "晴", icon: "100", windDir: "东风", windScale: "3" },
        { hour: "15:00", temp: 29, text: "晴", icon: "100", windDir: "东南风", windScale: "3" },
        { hour: "18:00", temp: 27, text: "多云", icon: "101", windDir: "南风", windScale: "2" },
        { hour: "21:00", temp: 24, text: "小雨", icon: "305", windDir: "西南风", windScale: "2" },
        { hour: "00:00", temp: 22, text: "小雨", icon: "305", windDir: "西风", windScale: "2" },
        { hour: "03:00", temp: 21, text: "阴", icon: "104", windDir: "西北风", windScale: "1" },
        { hour: "06:00", temp: 22, text: "阴", icon: "104", windDir: "北风", windScale: "1" }
      ],
      weather_14d: [
        { date: "09-21", text: "多云", high: 29, low: 21 },
        { date: "09-22", text: "阵雨", high: 27, low: 20 },
        { date: "09-23", text: "阴", high: 26, low: 20 }
      ],
      home_cards: [
        "晚上20:00 倒垃圾",
        "周三 物业缴费",
        "周末 补货生活用品"
      ],
      todo_summary: {
        total: 4,
        pending: 4,
        q1: 1,
        q2: 1,
        q3: 1,
        q4: 1
      },
      todo_preview: [
        { title: "补货墨水屏保护膜" },
        { title: "阅读 Rust 文档" },
        { title: "回复非紧急邮件" }
      ],
      todos: [
        { id: 1, title: "补货墨水屏保护膜", urgent: true, important: true, done: false },
        { id: 2, title: "阅读 Rust 文档", urgent: false, important: true, done: false },
        { id: 3, title: "回复非紧急邮件", urgent: true, important: false, done: false },
        { id: 4, title: "整理桌面", urgent: false, important: false, done: false }
      ]
    });
  }

  function setupEvents() {
    byId("openTodoBtn").onclick = function () {
      showBoard();
      return false;
    };

    byId("backHomeBtn").onclick = function () {
      showDashboard();
      return false;
    };

    byId("refreshBtn").onclick = function (e) {
      hardRefresh(e);
      return false;
    };
  }

  function init() {
    startClock();
    setupEvents();
    seedLocalMockIfNeeded();
    fetchDashboard();
    startPolling();
  }

  init();
})();
