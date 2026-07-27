def QuestionsMarks(strParam):
  i = 0
  count = 0
  while i<len(strParam):
    if strParam[i].isdigit() and count == 3:
      return True
    elif strParam[i].isdigit():
      count = 0
    elif strParam[i] == '?':
      count += 1

  return False



print(QuestionsMarks("acc?7??sss?3rr1??????5"))