package widgets

type Widget interface {
	Render(width, height int) string
}
