package core

type ScreenStack struct {
	items []Screen
}

func (s *ScreenStack) Push(screen Screen) {
	if screen == nil {
		return
	}
	s.items = append(s.items, screen)
}

func (s *ScreenStack) Pop() Screen {
	if len(s.items) == 0 {
		return nil
	}
	last := s.items[len(s.items)-1]
	s.items = s.items[:len(s.items)-1]
	return last
}

func (s ScreenStack) Top() Screen {
	if len(s.items) == 0 {
		return nil
	}
	return s.items[len(s.items)-1]
}

func (s ScreenStack) Len() int {
	return len(s.items)
}
