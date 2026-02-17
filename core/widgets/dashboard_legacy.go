package widgets

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/NimbleMarkets/ntcharts/canvas"
	"github.com/NimbleMarkets/ntcharts/linechart"
	tslc "github.com/NimbleMarkets/ntcharts/linechart/timeserieslinechart"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

type DashboardRow struct {
	DateISO       string
	Amount        float64
	CategoryName  string
	CategoryColor string
}

type DashboardCategory struct {
	Name  string
	Color string
}

var (
	dashColorSuccess  = lipgloss.Color("#a6e3a1")
	dashColorError    = lipgloss.Color("#f38ba8")
	dashColorOverlay1 = lipgloss.Color("#7f849c")
	dashColorSurface1 = lipgloss.Color("#45475a")
	dashColorSurface2 = lipgloss.Color("#585b70")
	dashColorBlue     = lipgloss.Color("#89b4fa")
	dashColorPeach    = lipgloss.Color("#fab387")

	dashInfoLabelStyle = lipgloss.NewStyle().Foreground(dashColorOverlay1)
	dashInfoValueStyle = lipgloss.NewStyle().Foreground(dashColorPeach)
)

func RenderRichSummaryCards(rows []DashboardRow, categories []DashboardCategory, width int) string {
	var income, expenses float64
	var uncatCount int
	var uncatTotal float64
	for _, r := range rows {
		if r.Amount > 0 {
			income += r.Amount
		} else {
			expenses += r.Amount
		}
		if dashIsUncategorised(r) {
			uncatCount++
			uncatTotal += math.Abs(r.Amount)
		}
	}
	balance := income + expenses

	_ = categories
	greenSty := lipgloss.NewStyle().Foreground(dashColorSuccess)
	redSty := lipgloss.NewStyle().Foreground(dashColorError)

	col1W := 32
	col2W := width - col1W
	if col2W < 16 {
		col2W = 16
	}

	debits := math.Abs(expenses)
	credits := income

	row1 := padRight(dashInfoLabelStyle.Render("Balance      ")+dashBalanceStyle(balance, greenSty, redSty), col1W) +
		padRight(dashInfoLabelStyle.Render("Uncat ")+dashInfoValueStyle.Render(fmt.Sprintf("%d (%s)", uncatCount, dashFormatMoney(uncatTotal))), col2W)

	row2 := padRight(dashInfoLabelStyle.Render("Debits       ")+redSty.Render(dashFormatMoney(debits)), col1W) +
		padRight(dashInfoLabelStyle.Render("Transactions ")+dashInfoValueStyle.Render(fmt.Sprintf("%d", len(rows))), col2W)

	row3 := padRight(dashInfoLabelStyle.Render("Credits      ")+greenSty.Render(dashFormatMoney(credits)), col1W) +
		padRight("", col2W)

	return row1 + "\n" + row2 + "\n" + row3
}

type dashCategorySpend struct {
	name   string
	color  string
	amount float64
}

func RenderRichCategoryBreakdown(rows []DashboardRow, categories []DashboardCategory, width int) string {
	spendMap := make(map[string]*dashCategorySpend)
	var totalExpenses float64
	for _, r := range rows {
		if r.Amount >= 0 {
			continue
		}
		abs := math.Abs(r.Amount)
		totalExpenses += abs
		key := r.CategoryName
		if key == "" {
			key = "Uncategorised"
		}
		if s, ok := spendMap[key]; ok {
			s.amount += abs
		} else {
			spendMap[key] = &dashCategorySpend{name: key, color: r.CategoryColor, amount: abs}
		}
	}

	for _, c := range categories {
		name := strings.TrimSpace(c.Name)
		if name == "" {
			continue
		}
		if _, ok := spendMap[name]; !ok {
			spendMap[name] = &dashCategorySpend{name: name, color: c.Color, amount: 0}
		}
	}
	if _, ok := spendMap["Uncategorised"]; !ok {
		spendMap["Uncategorised"] = &dashCategorySpend{name: "Uncategorised", color: "", amount: 0}
	}

	if len(spendMap) == 0 {
		return lipgloss.NewStyle().Foreground(dashColorOverlay1).Render("No category data to display.")
	}

	var sorted []dashCategorySpend
	for _, s := range spendMap {
		sorted = append(sorted, *s)
	}
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].amount != sorted[j].amount {
			return sorted[i].amount > sorted[j].amount
		}
		return strings.ToLower(sorted[i].name) < strings.ToLower(sorted[j].name)
	})

	display := sorted
	maxAmount := 0.0
	for _, s := range display {
		if s.amount > maxAmount {
			maxAmount = s.amount
		}
	}
	if maxAmount <= 0 {
		maxAmount = 1
	}

	if width < 24 {
		width = 24
	}
	pctW := 4
	amtW := 0
	for _, s := range display {
		w := len("$" + dashFormatWholeNumber(s.amount))
		if w > amtW {
			amtW = w
		}
	}
	if amtW < 2 {
		amtW = 2
	}
	minBarW := 1
	available := width - (1 + pctW + 1 + amtW)
	if available < 0 {
		available = 0
	}
	maxNameW := 26
	longestNameW := 0
	for _, s := range display {
		if w := len(s.name); w > longestNameW {
			longestNameW = w
		}
	}
	nameW := longestNameW + 2
	if nameW > maxNameW {
		nameW = maxNameW
	}
	minNameW := 4
	if nameW < minNameW {
		nameW = minNameW
	}
	maxNameForBar := available - minBarW
	if nameW > maxNameForBar {
		nameW = maxNameForBar
	}
	if nameW < 0 {
		nameW = 0
	}
	barW := available - nameW
	if barW < minBarW {
		need := minBarW - barW
		if nameW >= need {
			nameW -= need
			barW = minBarW
		} else {
			barW = 0
			nameW = available
		}
	}

	var lines []string
	for _, s := range display {
		pct := 0.0
		if totalExpenses > 0 {
			pct = s.amount / totalExpenses * 100
		}
		pctText := fmt.Sprintf("%4.0f%%", pct)
		amtText := fmt.Sprintf("%*s", amtW, "$"+dashFormatWholeNumber(s.amount))
		reservedRight := 1 + ansi.StringWidth(pctText) + 1 + ansi.StringWidth(amtText)
		availableLeft := width - reservedRight
		if availableLeft < 0 {
			availableLeft = 0
		}

		rowNameW := nameW
		if rowNameW > availableLeft-minBarW {
			rowNameW = availableLeft - minBarW
		}
		if rowNameW < 0 {
			rowNameW = 0
		}
		rowBarW := availableLeft - rowNameW
		if rowBarW < 0 {
			rowBarW = 0
		}

		ratio := s.amount / maxAmount
		filled := int(math.Round(float64(rowBarW) * ratio))
		if ratio >= 0.999999 {
			filled = rowBarW
		}
		if filled < 1 && s.amount > 0 && rowBarW > 0 {
			filled = 1
		}
		if filled > rowBarW {
			filled = rowBarW
		}
		if filled < 0 {
			filled = 0
		}
		empty := rowBarW - filled

		catColor := lipgloss.Color(s.color)
		if s.color == "" {
			catColor = dashColorOverlay1
		}

		nameSty := lipgloss.NewStyle().Foreground(catColor)
		barFilled := lipgloss.NewStyle().Foreground(catColor).Render(strings.Repeat("█", filled))
		barEmpty := lipgloss.NewStyle().Foreground(dashColorSurface2).Render(strings.Repeat("░", empty))
		pctStr := dashInfoLabelStyle.Render(pctText)
		amtStr := dashInfoValueStyle.Render(amtText)

		nameText := ""
		if rowNameW > 0 {
			nameText = padRight(nameSty.Render(truncate(s.name, rowNameW)), rowNameW)
		}
		line := nameText +
			barFilled + barEmpty + " " + pctStr + " " + amtStr
		for ansi.StringWidth(line) > width {
			if rowBarW > 0 {
				rowBarW--
				if filled > rowBarW {
					filled = rowBarW
				}
				empty = rowBarW - filled
				barFilled = lipgloss.NewStyle().Foreground(catColor).Render(strings.Repeat("█", filled))
				barEmpty = lipgloss.NewStyle().Foreground(dashColorSurface2).Render(strings.Repeat("░", empty))
			} else if rowNameW > 0 {
				rowNameW--
				nameText = padRight(nameSty.Render(truncate(s.name, rowNameW)), rowNameW)
			} else {
				break
			}
			line = nameText + barFilled + barEmpty + " " + pctStr + " " + amtStr
		}
		line = padRight(line, width)
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}

const richSpendingTrackerHeight = 14
const richSpendingTrackerYStep = 1

type richSpendingMajorMode int

const (
	richSpendingMajorWeek richSpendingMajorMode = iota
	richSpendingMajorMonth
	richSpendingMajorQuarter
)

type richSpendingAxisPlan struct {
	minorStepDays int
	majorMode     richSpendingMajorMode
	xLabels       map[string]string
	yStep         float64
	yMax          float64
}

func RenderRichSpendingTrackerWithRange(rows []DashboardRow, width int, weekAnchor time.Weekday, start, end time.Time) string {
	if width <= 0 {
		width = 20
	}
	values, dates := richAggregateDailySpendForRange(rows, start, end)
	if len(dates) == 0 {
		return lipgloss.NewStyle().Foreground(dashColorOverlay1).Render("No data for spending tracker.")
	}

	start = dates[0]
	end = dates[len(dates)-1]
	maxVal := 0.0
	for _, v := range values {
		if v > maxVal {
			maxVal = v
		}
	}
	if maxVal == 0 {
		maxVal = 1
	}

	chart := tslc.New(width, richSpendingTrackerHeight)
	chart.SetXStep(1)
	chart.SetYStep(richSpendingTrackerYStep)
	chart.SetStyle(lipgloss.NewStyle().Foreground(dashColorPeach))
	chart.AxisStyle = lipgloss.NewStyle().Foreground(dashColorSurface2)
	chart.LabelStyle = lipgloss.NewStyle().Foreground(dashColorOverlay1)
	chart.SetTimeRange(start, end)
	chart.SetViewTimeRange(start, end)

	plan := richPlanSpendingAxes(&chart, dates, maxVal)
	minVal := -(plan.yMax * 0.08)
	chart.SetYRange(minVal, plan.yMax)
	chart.SetViewYRange(minVal, plan.yMax)
	chart.Model.XLabelFormatter = richSpendingXLabelFormatter(plan.xLabels)
	chart.Model.YLabelFormatter = richSpendingYLabelFormatter(plan.yStep, plan.yMax)

	for i, d := range dates {
		chart.Push(tslc.TimePoint{Time: d, Value: values[i]})
	}

	chart.DrawBraille()
	richClearAxes(&chart)
	richRaiseXAxisLabels(&chart)
	richDrawVerticalGridlines(&chart, dates, plan, weekAnchor)

	return chart.View()
}

func richAggregateDailySpendForRange(rows []DashboardRow, start, end time.Time) ([]float64, []time.Time) {
	if end.Before(start) {
		return nil, nil
	}
	start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.Local)
	end = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.Local)
	startISO := start.Format("2006-01-02")
	endISO := end.Format("2006-01-02")
	days := int(end.Sub(start).Hours()/24) + 1
	if days <= 0 {
		return nil, nil
	}
	byDay := make(map[string]float64)
	for _, r := range rows {
		if r.DateISO < startISO || r.DateISO > endISO {
			continue
		}
		if r.Amount >= 0 {
			continue
		}
		byDay[r.DateISO] += -r.Amount
	}

	values := make([]float64, 0, days)
	dates := make([]time.Time, 0, days)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		values = append(values, byDay[key])
		dates = append(dates, d)
	}
	return values, dates
}

func richPlanSpendingAxes(chart *tslc.Model, dates []time.Time, maxVal float64) richSpendingAxisPlan {
	graphCols := chart.Width() - chart.Origin().X - 1
	if graphCols < 1 {
		graphCols = chart.Width()
	}
	minor := richSpendingMinorGridStep(len(dates), graphCols)
	mode := richSpendingMajorModeForDays(len(dates))
	yStep, yMax := richSpendingYScale(maxVal, chart.GraphHeight())
	return richSpendingAxisPlan{
		minorStepDays: minor,
		majorMode:     mode,
		xLabels:       richSpendingXLabels(chart, dates, minor, mode),
		yStep:         yStep,
		yMax:          yMax,
	}
}

func richSpendingMinorGridStep(days, graphCols int) int {
	if days <= 0 {
		return 1
	}
	if days <= 30 {
		return 1
	}
	if days <= 60 {
		return 2
	}
	if graphCols <= 0 {
		graphCols = days
	}
	maxMinorLines := max(1, graphCols/2)
	base := int(math.Ceil(float64(days) / float64(maxMinorLines)))
	if base < 1 {
		base = 1
	}
	return richSnapGridStep(base)
}

func richSnapGridStep(base int) int {
	steps := []int{1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90}
	for _, s := range steps {
		if base <= s {
			return s
		}
	}
	chunk := 30
	return int(math.Ceil(float64(base)/float64(chunk))) * chunk
}

func richSpendingMajorModeForDays(days int) richSpendingMajorMode {
	if days <= 120 {
		return richSpendingMajorWeek
	}
	if days <= 540 {
		return richSpendingMajorMonth
	}
	return richSpendingMajorQuarter
}

func richSpendingXLabels(chart *tslc.Model, dates []time.Time, minorStep int, majorMode richSpendingMajorMode) map[string]string {
	labels := make(map[string]string)
	if len(dates) == 0 {
		return labels
	}

	type candidate struct {
		x     int
		iso   string
		label string
		prio  int
	}

	var cands []candidate
	add := func(d time.Time, label string, prio int) {
		x := richChartColumnX(chart, d)
		if x <= chart.Origin().X || x >= chart.Width() {
			return
		}
		cands = append(cands, candidate{
			x:     x,
			iso:   d.Format("2006-01-02"),
			label: label,
			prio:  prio,
		})
	}

	start := dates[0]
	end := dates[len(dates)-1]
	startLabel := start.Format("2 Jan")
	endLabel := end.Format("2 Jan")
	if start.Year() != end.Year() {
		startLabel = start.Format("2 Jan 06")
		endLabel = end.Format("2 Jan 06")
	}
	add(start, startLabel, 0)
	add(end, endLabel, 0)

	for i, d := range dates {
		if d.Day() == 1 {
			switch majorMode {
			case richSpendingMajorQuarter:
				if richIsQuarterStart(d) {
					label := d.Format("Jan")
					if d.Month() == time.January {
						label = d.Format("Jan 06")
					}
					add(d, label, 1)
				}
			default:
				label := d.Format("Jan")
				if d.Month() == time.January {
					label = d.Format("Jan 06")
				}
				add(d, label, 1)
			}
		}
		if len(dates) <= 90 && minorStep > 0 && i%minorStep == 0 {
			add(d, fmt.Sprintf("%d", d.Day()), 2)
		}
	}

	minGap := 6
	for prio := 0; prio <= 2; prio++ {
		var tier []candidate
		for _, c := range cands {
			if c.prio == prio {
				tier = append(tier, c)
			}
		}
		sort.Slice(tier, func(i, j int) bool { return tier[i].x < tier[j].x })
		for _, c := range tier {
			if richCanPlaceXLabel(c, labels, chart, minGap) {
				labels[c.iso] = c.label
			}
		}
	}
	return labels
}

func richCanPlaceXLabel(c struct {
	x     int
	iso   string
	label string
	prio  int
}, placed map[string]string, chart *tslc.Model, minGap int) bool {
	for iso := range placed {
		t, err := time.ParseInLocation("2006-01-02", iso, time.Local)
		if err != nil {
			continue
		}
		x := richChartColumnX(chart, t)
		if richIntAbs(x-c.x) < minGap {
			return false
		}
	}
	return true
}

func richIntAbs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func richSpendingXLabelFormatter(labels map[string]string) linechart.LabelFormatter {
	return func(_ int, v float64) string {
		t := time.Unix(int64(v), 0).In(time.Local)
		iso := t.Format("2006-01-02")
		return labels[iso]
	}
}

func richSpendingYScale(maxVal float64, graphHeight int) (float64, float64) {
	if maxVal <= 0 {
		maxVal = 1
	}
	targetTicks := max(3, dashMinInt(6, graphHeight/3))
	if targetTicks <= 1 {
		targetTicks = 3
	}
	rawStep := maxVal / float64(targetTicks-1)
	step := richNiceCeil(rawStep)
	if step < 1 {
		step = 1
	}
	yMax := math.Ceil(maxVal/step) * step
	if yMax < step {
		yMax = step
	}
	return step, yMax
}

func richNiceCeil(v float64) float64 {
	if v <= 0 {
		return 1
	}
	pow := math.Pow(10, math.Floor(math.Log10(v)))
	f := v / pow
	switch {
	case f <= 1:
		return 1 * pow
	case f <= 2:
		return 2 * pow
	case f <= 5:
		return 5 * pow
	default:
		return 10 * pow
	}
}

func richSpendingYLabelFormatter(step, yMax float64) linechart.LabelFormatter {
	tolerance := step * 0.2
	return func(_ int, v float64) string {
		if v < 0 {
			return ""
		}
		if v < tolerance {
			return "0"
		}
		nearest := math.Round(v/step) * step
		if nearest < 0 || nearest > yMax+step*0.01 {
			return ""
		}
		if math.Abs(v-nearest) > tolerance {
			return ""
		}
		if nearest < 0.5 {
			return "0"
		}
		return richFormatAxisTick(nearest)
	}
}

func richFormatAxisTick(v float64) string {
	if v < 0 {
		v = -v
	}
	switch {
	case v >= 1_000_000:
		m := v / 1_000_000
		if m < 10 {
			return richTrimTrailingDecimal(fmt.Sprintf("%.1fm", m))
		}
		return fmt.Sprintf("%dm", int(m))
	case v >= 1_000:
		k := v / 1_000
		if k < 10 {
			return richTrimTrailingDecimal(fmt.Sprintf("%.1fk", k))
		}
		return fmt.Sprintf("%dk", int(k))
	default:
		return dashFormatWholeNumber(v)
	}
}

func richTrimTrailingDecimal(s string) string {
	return strings.Replace(s, ".0", "", 1)
}

func richClearAxes(chart *tslc.Model) {
	origin := chart.Origin()
	topY := origin.Y - chart.GraphHeight()
	if topY < 0 {
		topY = 0
	}
	for y := topY; y <= origin.Y; y++ {
		p := canvas.Point{X: origin.X, Y: y}
		chart.Canvas.SetCell(p, canvas.NewCell(0))
	}
	for x := origin.X; x < chart.Width(); x++ {
		p := canvas.Point{X: x, Y: origin.Y}
		chart.Canvas.SetCell(p, canvas.NewCell(0))
	}
}

func richRaiseXAxisLabels(chart *tslc.Model) {
	origin := chart.Origin()
	labelY := origin.Y + 1
	if labelY < 0 || labelY >= chart.Canvas.Height() {
		return
	}
	for x := 0; x < chart.Width(); x++ {
		from := canvas.Point{X: x, Y: labelY}
		cell := chart.Canvas.Cell(from)
		if cell.Rune == 0 {
			continue
		}
		to := canvas.Point{X: x, Y: origin.Y}
		if chart.Canvas.Cell(to).Rune != 0 {
			continue
		}
		chart.Canvas.SetCell(to, cell)
		chart.Canvas.SetCell(from, canvas.NewCell(0))
	}
}

func richDrawVerticalGridlines(chart *tslc.Model, dates []time.Time, plan richSpendingAxisPlan, weekAnchor time.Weekday) {
	if len(dates) == 0 || plan.minorStepDays <= 0 {
		return
	}
	origin := chart.Origin()
	topY := origin.Y - chart.GraphHeight()
	bottomY := origin.Y - 1
	if topY < 0 || bottomY < 0 {
		return
	}
	minorStyle := lipgloss.NewStyle().Foreground(dashColorSurface1)
	majorStyle := lipgloss.NewStyle().Foreground(dashColorBlue)
	columns := make(map[int]bool)
	for i, d := range dates {
		isMajor := richIsMajorBoundary(d, plan.majorMode, weekAnchor)
		if !isMajor && i%plan.minorStepDays != 0 {
			continue
		}
		x := richChartColumnX(chart, d)
		if x <= origin.X || x >= chart.Width() {
			continue
		}
		if isMajor {
			columns[x] = true
			continue
		}
		if _, exists := columns[x]; !exists {
			columns[x] = false
		}
	}
	for x, isMajor := range columns {
		style := minorStyle
		if isMajor {
			style = majorStyle
		}
		for y := topY; y <= bottomY; y++ {
			p := canvas.Point{X: x, Y: y}
			if chart.Canvas.Cell(p).Rune != 0 {
				continue
			}
			chart.Canvas.SetRuneWithStyle(p, '│', style)
		}
	}
}

func richIsMajorBoundary(d time.Time, mode richSpendingMajorMode, weekAnchor time.Weekday) bool {
	switch mode {
	case richSpendingMajorWeek:
		return d.Weekday() == weekAnchor
	case richSpendingMajorMonth:
		return d.Day() == 1
	case richSpendingMajorQuarter:
		return d.Day() == 1 && richIsQuarterStart(d)
	default:
		return false
	}
}

func richIsQuarterStart(d time.Time) bool {
	switch d.Month() {
	case time.January, time.April, time.July, time.October:
		return true
	default:
		return false
	}
}

func richChartColumnX(chart *tslc.Model, ts time.Time) int {
	point := canvas.Float64Point{X: float64(ts.Unix()), Y: chart.ViewMinY()}
	scaled := chart.ScaleFloat64Point(point)
	p := canvas.CanvasPointFromFloat64Point(chart.Origin(), scaled)
	if chart.YStep() > 0 {
		p.X++
	}
	if chart.XStep() > 0 {
		p.Y--
	}
	return p.X
}

func dashIsUncategorised(r DashboardRow) bool {
	if strings.TrimSpace(r.CategoryName) == "" {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.CategoryName), "Uncategorised")
}

func dashBalanceStyle(amount float64, green, red lipgloss.Style) string {
	s := dashFormatMoney(math.Abs(amount))
	if amount >= 0 {
		return green.Render(s)
	}
	return red.Render("-" + s)
}

func dashFormatMoney(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	whole := int64(v)
	frac := v - float64(whole)
	s := fmt.Sprintf("%d", whole)
	if len(s) > 3 {
		var parts []string
		for len(s) > 3 {
			parts = append([]string{s[len(s)-3:]}, parts...)
			s = s[:len(s)-3]
		}
		parts = append([]string{s}, parts...)
		s = strings.Join(parts, ",")
	}
	result := fmt.Sprintf("$%s.%02d", s, int(frac*100+0.5))
	if neg {
		return "-" + result
	}
	return result
}

func dashFormatWholeNumber(v float64) string {
	if v < 0 {
		v = -v
	}
	whole := int64(math.Round(v))
	s := fmt.Sprintf("%d", whole)
	if len(s) > 3 {
		var parts []string
		for len(s) > 3 {
			parts = append([]string{s[len(s)-3:]}, parts...)
			s = s[:len(s)-3]
		}
		parts = append([]string{s}, parts...)
		s = strings.Join(parts, ",")
	}
	return s
}

func dashMinInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

