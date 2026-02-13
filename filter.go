package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

type filterNodeKind int

const (
	filterNodeText filterNodeKind = iota
	filterNodeField
	filterNodeAnd
	filterNodeOr
	filterNodeNot
)

type filterNode struct {
	kind filterNodeKind

	// Text/Field
	field   string
	op      string
	value   string
	valueLo string
	valueHi string

	// Boolean
	children []*filterNode

	// grouped marks nodes explicitly wrapped in parentheses in source.
	grouped bool
}

type filterTokenKind int

const (
	filterTokInvalid filterTokenKind = iota
	filterTokWord
	filterTokQuoted
	filterTokColon
	filterTokLParen
	filterTokRParen
	filterTokAnd
	filterTokOr
	filterTokNot
	filterTokEOF
)

type filterToken struct {
	kind filterTokenKind
	text string
	pos  int
}

type filterParser struct {
	tokens []filterToken
	idx    int
	strict bool
}

func parseFilter(input string) (*filterNode, error) {
	return parseFilterWithMode(input, false)
}

func parseFilterStrict(input string) (*filterNode, error) {
	return parseFilterWithMode(input, true)
}

func parseFilterWithMode(input string, strict bool) (*filterNode, error) {
	if strings.TrimSpace(input) == "" {
		return nil, nil
	}
	tokens, err := lexFilter(input)
	if err != nil {
		return nil, err
	}
	p := filterParser{tokens: tokens, strict: strict}
	node, err := p.parseExpr()
	if err != nil {
		return nil, err
	}
	if p.peek().kind != filterTokEOF {
		tok := p.peek()
		return nil, fmt.Errorf("unexpected token %q at %d", tok.text, tok.pos+1)
	}
	if strict {
		if err := validateStrictGrouping(node); err != nil {
			return nil, err
		}
	}
	return node, nil
}

func fallbackPlainTextFilter(input string) *filterNode {
	text := strings.TrimSpace(input)
	if text == "" {
		return nil
	}
	return &filterNode{kind: filterNodeText, op: "contains_meta", value: text}
}

func lexFilter(input string) ([]filterToken, error) {
	out := make([]filterToken, 0, len(input)/2)
	for i := 0; i < len(input); {
		ch := input[i]
		if isFilterSpace(ch) {
			i++
			continue
		}
		switch ch {
		case '(':
			out = append(out, filterToken{kind: filterTokLParen, text: "(", pos: i})
			i++
		case ')':
			out = append(out, filterToken{kind: filterTokRParen, text: ")", pos: i})
			i++
		case ':':
			out = append(out, filterToken{kind: filterTokColon, text: ":", pos: i})
			i++
		case '"':
			start := i
			i++
			var b strings.Builder
			closed := false
			for i < len(input) {
				if input[i] == '"' {
					i++
					closed = true
					break
				}
				if input[i] == '\\' {
					if i+1 >= len(input) {
						return nil, fmt.Errorf("unterminated escape at %d", i+1)
					}
					next := input[i+1]
					switch next {
					case '"', '\\':
						b.WriteByte(next)
						i += 2
					default:
						return nil, fmt.Errorf("unsupported escape \\%c at %d", next, i+1)
					}
					continue
				}
				b.WriteByte(input[i])
				i++
			}
			if !closed {
				return nil, fmt.Errorf("unterminated quoted string at %d", start+1)
			}
			out = append(out, filterToken{kind: filterTokQuoted, text: b.String(), pos: start})
		default:
			start := i
			for i < len(input) {
				c := input[i]
				if isFilterSpace(c) || c == '(' || c == ')' || c == ':' || c == '"' {
					break
				}
				i++
			}
			word := input[start:i]
			kind := filterTokWord
			switch word {
			case "AND":
				kind = filterTokAnd
			case "OR":
				kind = filterTokOr
			case "NOT":
				kind = filterTokNot
			}
			out = append(out, filterToken{kind: kind, text: word, pos: start})
		}
	}
	out = append(out, filterToken{kind: filterTokEOF, pos: len(input)})
	return out, nil
}

func isFilterSpace(ch byte) bool {
	return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r'
}

func (p *filterParser) parseExpr() (*filterNode, error) {
	return p.parseOrExpr()
}

func (p *filterParser) parseOrExpr() (*filterNode, error) {
	left, err := p.parseAndExpr()
	if err != nil {
		return nil, err
	}
	children := []*filterNode{left}
	for p.peek().kind == filterTokOr {
		p.consume()
		right, err := p.parseAndExpr()
		if err != nil {
			return nil, err
		}
		children = append(children, right)
	}
	if len(children) == 1 {
		return children[0], nil
	}
	return &filterNode{kind: filterNodeOr, children: flattenFilterChildren(filterNodeOr, children)}, nil
}

func (p *filterParser) parseAndExpr() (*filterNode, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	children := []*filterNode{left}
	for {
		tok := p.peek()
		if tok.kind == filterTokAnd {
			p.consume()
			next, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			children = append(children, next)
			continue
		}
		if filterCanStartTerm(tok.kind) {
			next, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			children = append(children, next)
			continue
		}
		break
	}
	if len(children) == 1 {
		return children[0], nil
	}
	return &filterNode{kind: filterNodeAnd, children: flattenFilterChildren(filterNodeAnd, children)}, nil
}

func filterCanStartTerm(kind filterTokenKind) bool {
	switch kind {
	case filterTokLParen, filterTokWord, filterTokQuoted, filterTokNot:
		return true
	default:
		return false
	}
}

func (p *filterParser) parseUnary() (*filterNode, error) {
	if p.peek().kind == filterTokNot {
		p.consume()
		child, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return &filterNode{kind: filterNodeNot, children: []*filterNode{child}}, nil
	}
	return p.parseTerm()
}

func (p *filterParser) parseTerm() (*filterNode, error) {
	tok := p.peek()
	switch tok.kind {
	case filterTokLParen:
		p.consume()
		n, err := p.parseExpr()
		if err != nil {
			return nil, err
		}
		if p.peek().kind != filterTokRParen {
			next := p.peek()
			return nil, fmt.Errorf("missing ')' at %d", next.pos+1)
		}
		p.consume()
		n.grouped = true
		return n, nil
	case filterTokQuoted:
		q := p.consume()
		return &filterNode{kind: filterNodeText, op: "contains", value: q.text}, nil
	case filterTokWord:
		if p.isFieldPredicateAt(p.idx) {
			return p.parseFieldPredicate()
		}
		w := p.consume()
		return &filterNode{kind: filterNodeText, op: "contains", value: w.text}, nil
	default:
		if tok.kind == filterTokEOF {
			return nil, fmt.Errorf("unexpected end of expression")
		}
		return nil, fmt.Errorf("unexpected token %q at %d", tok.text, tok.pos+1)
	}
}

func (p *filterParser) parseFieldPredicate() (*filterNode, error) {
	fieldTok := p.consume()
	field := strings.ToLower(strings.TrimSpace(fieldTok.text))
	p.consume() // colon

	if !isFilterField(field) {
		return nil, fmt.Errorf("unknown field %q at %d", fieldTok.text, fieldTok.pos+1)
	}

	switch field {
	case "amt":
		raw, err := p.collectFieldValue(field, false)
		if err != nil {
			return nil, err
		}
		n, err := parseAmountField(raw, fieldTok.pos)
		if err != nil {
			return nil, err
		}
		n.field = field
		return n, nil
	case "date":
		raw, err := p.collectFieldValue(field, false)
		if err != nil {
			return nil, err
		}
		n, err := parseDateField(raw, fieldTok.pos)
		if err != nil {
			return nil, err
		}
		n.field = field
		return n, nil
	case "type":
		raw, err := p.collectFieldValue(field, false)
		if err != nil {
			return nil, err
		}
		v := strings.ToLower(strings.TrimSpace(raw))
		if v != "debit" && v != "credit" {
			return nil, fmt.Errorf("type expects debit|credit at %d", fieldTok.pos+1)
		}
		return &filterNode{kind: filterNodeField, field: field, op: "=", value: v}, nil
	case "cat", "tag", "acc":
		raw, err := p.collectFieldValue(field, true)
		if err != nil {
			return nil, err
		}
		return &filterNode{kind: filterNodeField, field: field, op: "=", value: strings.TrimSpace(raw)}, nil
	case "desc", "note":
		raw, err := p.collectFieldValue(field, true)
		if err != nil {
			return nil, err
		}
		return &filterNode{kind: filterNodeField, field: field, op: "contains", value: strings.TrimSpace(raw)}, nil
	default:
		return nil, fmt.Errorf("unsupported field %q", field)
	}
}

func (p *filterParser) collectFieldValue(field string, allowMulti bool) (string, error) {
	if p.peek().kind == filterTokQuoted {
		return p.consume().text, nil
	}
	words := make([]string, 0, 2)
	for {
		tok := p.peek()
		if tok.kind != filterTokWord {
			break
		}
		if len(words) > 0 && p.isFieldPredicateAt(p.idx) {
			break
		}
		words = append(words, tok.text)
		p.consume()
		if !allowMulti {
			break
		}
		next := p.peek().kind
		if next == filterTokEOF || next == filterTokRParen || next == filterTokAnd || next == filterTokOr {
			break
		}
	}
	if len(words) == 0 {
		tok := p.peek()
		if tok.kind == filterTokEOF || tok.kind == filterTokRParen {
			return "", fmt.Errorf("%s: missing value", field)
		}
		return "", fmt.Errorf("%s: invalid value near %q", field, tok.text)
	}
	return strings.Join(words, " "), nil
}

func (p *filterParser) isFieldPredicateAt(i int) bool {
	if i+1 >= len(p.tokens) {
		return false
	}
	if p.tokens[i].kind != filterTokWord || p.tokens[i+1].kind != filterTokColon {
		return false
	}
	return isFilterField(strings.ToLower(strings.TrimSpace(p.tokens[i].text)))
}

func (p *filterParser) peek() filterToken {
	if p.idx >= len(p.tokens) {
		return filterToken{kind: filterTokEOF, pos: len(p.tokens)}
	}
	return p.tokens[p.idx]
}

func (p *filterParser) consume() filterToken {
	tok := p.peek()
	if p.idx < len(p.tokens) {
		p.idx++
	}
	return tok
}

func isFilterField(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "desc", "cat", "tag", "acc", "amt", "type", "note", "date":
		return true
	default:
		return false
	}
}

func parseAmountField(raw string, pos int) (*filterNode, error) {
	v := strings.ReplaceAll(strings.TrimSpace(raw), " ", "")
	if v == "" {
		return nil, fmt.Errorf("amt: missing value at %d", pos+1)
	}
	if strings.Contains(v, "..") {
		parts := strings.SplitN(v, "..", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return nil, fmt.Errorf("amt: invalid range %q", raw)
		}
		lo, err := parseFilterNumber(parts[0])
		if err != nil {
			return nil, fmt.Errorf("amt: invalid range low %q", parts[0])
		}
		hi, err := parseFilterNumber(parts[1])
		if err != nil {
			return nil, fmt.Errorf("amt: invalid range high %q", parts[1])
		}
		if lo > hi {
			return nil, fmt.Errorf("amt: range low > high")
		}
		return &filterNode{kind: filterNodeField, op: "..", valueLo: canonicalFloat(lo), valueHi: canonicalFloat(hi)}, nil
	}
	ops := []string{"<=", ">=", "<", ">", "="}
	for _, op := range ops {
		if strings.HasPrefix(v, op) {
			numText := strings.TrimSpace(strings.TrimPrefix(v, op))
			n, err := parseFilterNumber(numText)
			if err != nil {
				return nil, fmt.Errorf("amt: invalid number %q", numText)
			}
			return &filterNode{kind: filterNodeField, op: op, value: canonicalFloat(n)}, nil
		}
	}
	n, err := parseFilterNumber(v)
	if err != nil {
		return nil, fmt.Errorf("amt: invalid value %q", raw)
	}
	return &filterNode{kind: filterNodeField, op: "=", value: canonicalFloat(n)}, nil
}

func parseFilterNumber(v string) (float64, error) {
	if strings.TrimSpace(v) == "" {
		return 0, fmt.Errorf("empty")
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, err
	}
	return n, nil
}

func canonicalFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func parseDateField(raw string, pos int) (*filterNode, error) {
	v := strings.ReplaceAll(strings.TrimSpace(raw), " ", "")
	if v == "" {
		return nil, fmt.Errorf("date: missing value at %d", pos+1)
	}
	if strings.Contains(v, "..") {
		parts := strings.SplitN(v, "..", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return nil, fmt.Errorf("date: invalid range %q", raw)
		}
		lo, err := canonicalDateToken(parts[0])
		if err != nil {
			return nil, fmt.Errorf("date: invalid start %q", parts[0])
		}
		hi, err := canonicalDateToken(parts[1])
		if err != nil {
			return nil, fmt.Errorf("date: invalid end %q", parts[1])
		}
		loStart, _ := dateTokenBounds(lo)
		_, hiEnd := dateTokenBounds(hi)
		if hiEnd.Before(loStart) {
			return nil, fmt.Errorf("date: range start is after end")
		}
		return &filterNode{kind: filterNodeField, op: "..", valueLo: lo, valueHi: hi}, nil
	}
	canon, err := canonicalDateToken(v)
	if err != nil {
		return nil, fmt.Errorf("date: invalid value %q", raw)
	}
	return &filterNode{kind: filterNodeField, op: "=", value: canon}, nil
}

func canonicalDateToken(v string) (string, error) {
	v = strings.TrimSpace(v)
	switch {
	case isISODay(v):
		if _, err := time.ParseInLocation("2006-01-02", v, time.Local); err != nil {
			return "", err
		}
		return v, nil
	case isISOMonth(v):
		y, m := parseYearMonth(v)
		if !validYearMonth(y, m) {
			return "", fmt.Errorf("invalid month")
		}
		return fmt.Sprintf("%04d-%02d", y, m), nil
	case isYYMonth(v):
		parts := strings.Split(v, "-")
		y, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		y += 2000
		if !validYearMonth(y, m) {
			return "", fmt.Errorf("invalid month")
		}
		return fmt.Sprintf("%04d-%02d", y, m), nil
	default:
		return "", fmt.Errorf("invalid date token")
	}
}

func parseYearMonth(v string) (int, int) {
	parts := strings.Split(v, "-")
	if len(parts) != 2 {
		return 0, 0
	}
	y, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	return y, m
}

func validYearMonth(y, m int) bool {
	if y < 1 || m < 1 || m > 12 {
		return false
	}
	return true
}

func isISODay(v string) bool {
	if len(v) != 10 {
		return false
	}
	for i := 0; i < len(v); i++ {
		switch i {
		case 4, 7:
			if v[i] != '-' {
				return false
			}
		default:
			if v[i] < '0' || v[i] > '9' {
				return false
			}
		}
	}
	return true
}

func isISOMonth(v string) bool {
	if len(v) != 7 {
		return false
	}
	for i := 0; i < len(v); i++ {
		switch i {
		case 4:
			if v[i] != '-' {
				return false
			}
		default:
			if v[i] < '0' || v[i] > '9' {
				return false
			}
		}
	}
	return true
}

func isYYMonth(v string) bool {
	if len(v) != 5 {
		return false
	}
	for i := 0; i < len(v); i++ {
		switch i {
		case 2:
			if v[i] != '-' {
				return false
			}
		default:
			if v[i] < '0' || v[i] > '9' {
				return false
			}
		}
	}
	return true
}

func dateTokenBounds(v string) (time.Time, time.Time) {
	if isISODay(v) {
		d, _ := time.ParseInLocation("2006-01-02", v, time.Local)
		return d, d
	}
	y, m := parseYearMonth(v)
	start := time.Date(y, time.Month(m), 1, 0, 0, 0, 0, time.Local)
	end := start.AddDate(0, 1, -1)
	return start, end
}

func validateStrictGrouping(node *filterNode) error {
	if node == nil {
		return nil
	}
	if hasStrictMixedGroupingViolation(node) {
		suggestion := filterExprStringWithMode(node, true)
		return fmt.Errorf("strict mode requires parentheses when mixing AND/OR; try: %s", suggestion)
	}
	return nil
}

func hasStrictMixedGroupingViolation(node *filterNode) bool {
	if node == nil {
		return false
	}
	for _, child := range node.children {
		if child == nil {
			continue
		}
		if node.kind == filterNodeAnd && child.kind == filterNodeOr && !child.grouped {
			return true
		}
		if node.kind == filterNodeOr && child.kind == filterNodeAnd && !child.grouped {
			return true
		}
		if hasStrictMixedGroupingViolation(child) {
			return true
		}
	}
	return false
}

func evalFilter(node *filterNode, t transaction, tags []tag) bool {
	if node == nil {
		return true
	}
	switch node.kind {
	case filterNodeText:
		needle := strings.ToLower(strings.TrimSpace(node.value))
		if needle == "" {
			return true
		}
		return evalTextFilter(node.op, needle, t, tags)
	case filterNodeField:
		return evalFieldFilter(node, t, tags)
	case filterNodeAnd:
		for _, child := range node.children {
			if !evalFilter(child, t, tags) {
				return false
			}
		}
		return true
	case filterNodeOr:
		for _, child := range node.children {
			if evalFilter(child, t, tags) {
				return true
			}
		}
		return false
	case filterNodeNot:
		if len(node.children) == 0 {
			return true
		}
		return !evalFilter(node.children[0], t, tags)
	default:
		return true
	}
}

func evalTextFilter(op, needle string, t transaction, tags []tag) bool {
	if strings.Contains(strings.ToLower(t.description), needle) {
		return true
	}
	if op == "contains_meta" {
		if strings.Contains(strings.ToLower(t.categoryName), needle) {
			return true
		}
		for _, tg := range tags {
			if strings.Contains(strings.ToLower(strings.TrimSpace(tg.name)), needle) {
				return true
			}
		}
	}
	return false
}

func evalFieldFilter(node *filterNode, t transaction, tags []tag) bool {
	field := strings.ToLower(node.field)
	switch field {
	case "desc":
		return strings.Contains(strings.ToLower(t.description), strings.ToLower(node.value))
	case "note":
		return strings.Contains(strings.ToLower(t.notes), strings.ToLower(node.value))
	case "cat":
		return strings.EqualFold(strings.TrimSpace(t.categoryName), strings.TrimSpace(node.value))
	case "acc":
		return strings.EqualFold(strings.TrimSpace(t.accountName), strings.TrimSpace(node.value))
	case "tag":
		want := strings.TrimSpace(node.value)
		for _, tg := range tags {
			if strings.EqualFold(strings.TrimSpace(tg.name), want) {
				return true
			}
		}
		return false
	case "type":
		want := strings.ToLower(strings.TrimSpace(node.value))
		if want == "debit" {
			return t.amount < 0
		}
		if want == "credit" {
			return t.amount > 0
		}
		return false
	case "amt":
		return evalAmountField(node, t.amount)
	case "date":
		return evalDateField(node, t.dateISO)
	default:
		return false
	}
}

func evalAmountField(node *filterNode, amt float64) bool {
	switch node.op {
	case "..":
		lo, errLo := parseFilterNumber(node.valueLo)
		hi, errHi := parseFilterNumber(node.valueHi)
		if errLo != nil || errHi != nil {
			return false
		}
		return amt >= lo && amt <= hi
	case "=", ">", "<", ">=", "<=":
		v, err := parseFilterNumber(node.value)
		if err != nil {
			return false
		}
		switch node.op {
		case "=":
			return amt == v
		case ">":
			return amt > v
		case "<":
			return amt < v
		case ">=":
			return amt >= v
		case "<=":
			return amt <= v
		}
	}
	return false
}

func evalDateField(node *filterNode, dateISO string) bool {
	txnDate, err := time.ParseInLocation("2006-01-02", dateISO, time.Local)
	if err != nil {
		return false
	}
	switch node.op {
	case "=":
		lo, hi := dateTokenBounds(node.value)
		return !txnDate.Before(lo) && !txnDate.After(hi)
	case "..":
		loStart, _ := dateTokenBounds(node.valueLo)
		_, hiEnd := dateTokenBounds(node.valueHi)
		return !txnDate.Before(loStart) && !txnDate.After(hiEnd)
	default:
		return false
	}
}

func filterExprString(node *filterNode) string {
	return filterExprStringWithMode(node, false)
}

func filterExprStringWithMode(node *filterNode, strictGroups bool) string {
	if node == nil {
		return ""
	}
	return renderFilterNode(node, 0, strictGroups)
}

func renderFilterNode(node *filterNode, parentPrec int, strictGroups bool) string {
	if node == nil {
		return ""
	}
	prec := filterNodePrecedence(node.kind)
	var s string
	switch node.kind {
	case filterNodeText:
		s = filterFormatValue(node.value, false)
	case filterNodeField:
		s = renderFieldNode(node)
	case filterNodeNot:
		child := ""
		if len(node.children) > 0 {
			child = renderFilterNode(node.children[0], prec, strictGroups)
			if needsFilterParens(node.children[0], prec, strictGroups, node.kind) {
				child = "(" + child + ")"
			}
		}
		s = "NOT " + child
	case filterNodeAnd, filterNodeOr:
		joiner := " AND "
		if node.kind == filterNodeOr {
			joiner = " OR "
		}
		parts := make([]string, 0, len(node.children))
		for _, child := range node.children {
			if child == nil {
				continue
			}
			part := renderFilterNode(child, prec, strictGroups)
			if needsFilterParens(child, prec, strictGroups, node.kind) {
				part = "(" + part + ")"
			}
			parts = append(parts, part)
		}
		s = strings.Join(parts, joiner)
	default:
		return ""
	}
	if parentPrec > 0 && prec > 0 && prec < parentPrec {
		s = "(" + s + ")"
	}
	return s
}

func renderFieldNode(node *filterNode) string {
	field := strings.ToLower(node.field)
	switch node.op {
	case "..":
		return field + ":" + node.valueLo + ".." + node.valueHi
	case "=", ">", "<", ">=", "<=":
		if field == "amt" {
			if node.op == "=" {
				return field + ":=" + node.value
			}
			return field + ":" + node.op + node.value
		}
		if field == "type" || field == "date" {
			if node.op == "=" {
				return field + ":" + node.value
			}
			return field + ":" + node.op + node.value
		}
		if node.op == "contains" {
			return field + ":" + filterFormatValue(node.value, true)
		}
		return field + ":" + filterFormatValue(node.value, true)
	case "contains":
		return field + ":" + filterFormatValue(node.value, true)
	default:
		return field + ":" + filterFormatValue(node.value, true)
	}
}

func filterFormatValue(v string, allowBare bool) string {
	if allowBare && isFilterBareWord(v) {
		return v
	}
	if !allowBare && isFilterBareWord(v) {
		return v
	}
	return quoteFilterString(v)
}

func isFilterBareWord(v string) bool {
	if strings.TrimSpace(v) == "" {
		return false
	}
	for i := 0; i < len(v); i++ {
		ch := v[i]
		if isFilterSpace(ch) || ch == '(' || ch == ')' || ch == ':' || ch == '"' {
			return false
		}
	}
	if v == "AND" || v == "OR" || v == "NOT" {
		return false
	}
	return true
}

func quoteFilterString(v string) string {
	replacer := strings.NewReplacer("\\", "\\\\", `"`, `\\"`)
	return `"` + replacer.Replace(v) + `"`
}

func filterNodePrecedence(kind filterNodeKind) int {
	switch kind {
	case filterNodeOr:
		return 1
	case filterNodeAnd:
		return 2
	case filterNodeNot:
		return 3
	case filterNodeText, filterNodeField:
		return 4
	default:
		return 0
	}
}

func needsFilterParens(child *filterNode, parentPrec int, strictGroups bool, parentKind filterNodeKind) bool {
	if child == nil {
		return false
	}
	childPrec := filterNodePrecedence(child.kind)
	if childPrec < parentPrec {
		return true
	}
	if strictGroups {
		if parentKind == filterNodeAnd && child.kind == filterNodeOr {
			return true
		}
		if parentKind == filterNodeOr && child.kind == filterNodeAnd {
			return true
		}
	}
	return false
}

func flattenFilterChildren(kind filterNodeKind, in []*filterNode) []*filterNode {
	out := make([]*filterNode, 0, len(in))
	for _, child := range in {
		if child == nil {
			continue
		}
		if child.kind == kind && !child.grouped {
			out = append(out, child.children...)
			continue
		}
		out = append(out, child)
	}
	return out
}

func filterContainsFieldPredicate(node *filterNode) bool {
	if node == nil {
		return false
	}
	if node.kind == filterNodeField {
		return true
	}
	for _, child := range node.children {
		if filterContainsFieldPredicate(child) {
			return true
		}
	}
	return false
}

func markTextNodesAsMetadata(node *filterNode) *filterNode {
	if node == nil {
		return nil
	}
	out := *node
	if out.kind == filterNodeText {
		out.op = "contains_meta"
	}
	if len(out.children) > 0 {
		out.children = make([]*filterNode, 0, len(node.children))
		for _, child := range node.children {
			out.children = append(out.children, markTextNodesAsMetadata(child))
		}
	}
	return &out
}

func andFilterNodes(nodes ...*filterNode) *filterNode {
	filtered := make([]*filterNode, 0, len(nodes))
	for _, n := range nodes {
		if n == nil {
			continue
		}
		if n.kind == filterNodeAnd {
			filtered = append(filtered, n.children...)
			continue
		}
		filtered = append(filtered, n)
	}
	if len(filtered) == 0 {
		return nil
	}
	if len(filtered) == 1 {
		return filtered[0]
	}
	return &filterNode{kind: filterNodeAnd, children: filtered}
}

func orFilterNodes(nodes ...*filterNode) *filterNode {
	filtered := make([]*filterNode, 0, len(nodes))
	for _, n := range nodes {
		if n == nil {
			continue
		}
		if n.kind == filterNodeOr {
			filtered = append(filtered, n.children...)
			continue
		}
		filtered = append(filtered, n)
	}
	if len(filtered) == 0 {
		return nil
	}
	if len(filtered) == 1 {
		return filtered[0]
	}
	return &filterNode{kind: filterNodeOr, children: filtered}
}
