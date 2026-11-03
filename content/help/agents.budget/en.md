## Result

You set the limits before the run, and the agent cannot exceed them. When a limit is reached the task fails without a partial write.

## What is limited

- **Changes** — how many objects the agent may create. This is the "Max changes" field in the dialog; it is checked before writing.
- **Money** — the maximum cost in dollars at the provider's price. This is the "Max cost, $" field; it is checked after the model call.
- **Tokens** — how much the model may read and write. The dialog does not set them: the server uses 8 000 tokens unless the request says otherwise.
- **Time** — how many seconds the task may run. The dialog does not set it: the server uses 120 seconds unless the request says otherwise.

## The rule

A task without a budget is not created. That is not paperwork: the budget is your consent to spend money and change the board. The server fills in the token and time defaults only once a budget exists.

## Steps

1. In the agent dialog set "Max changes".
2. Set "Max cost, $".
3. Run the task.

## If it did not work

- **"Set a limit".** The changes field is empty or zero; the task was not created.
- **`BUDGET_EXCEEDED` or `BUDGET_ACTIONS`.** The agent stopped; a partial result is not applied. Raise the limit and run again.
- **`TOO_MANY_TASKS`.** The board already has a queue; wait for it or cancel a task.
